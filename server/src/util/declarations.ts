import * as LSP from 'vscode-languageserver/node'
import * as Parser from 'web-tree-sitter'

import * as TreeSitterUtil from './tree-sitter'

const TREE_SITTER_TYPE_TO_LSP_KIND: { [type: string]: LSP.SymbolKind | undefined } = {
  // These keys are using underscores as that's the naming convention in tree-sitter.
  environment_variable_assignment: LSP.SymbolKind.Variable,
  function_definition: LSP.SymbolKind.Function,
  variable_assignment: LSP.SymbolKind.Variable,
}

export type GlobalDeclarations = { [word: string]: LSP.SymbolInformation }
export type Declarations = { [word: string]: LSP.SymbolInformation[] }

/**
 * Returns declarations (functions or variables) from a given root node
 * that would be available after sourcing the file. This currently does
 * not include global variables defined inside function as we do not do
 * any flow tracing.
 *
 * Will only return one declaration per symbol name – the latest definition.
 * This behavior is consistent with how Bash behaves, but differs between
 * LSP servers.
 *
 * Used when finding declarations for sourced files and to get declarations
 * for the entire workspace.
 */
export function getGlobalDeclarations({
  tree,
  uri,
}: {
  tree: Parser.Tree
  uri: string
}): {
  diagnostics: LSP.Diagnostic[]
  globalDeclarations: GlobalDeclarations
} {
  const diagnostics: LSP.Diagnostic[] = []
  const globalDeclarations: GlobalDeclarations = {}

  tree.rootNode.children.forEach((node) => {
    if (node.type === 'ERROR') {
      diagnostics.push(
        LSP.Diagnostic.create(
          TreeSitterUtil.range(node),
          'Failed to parse',
          LSP.DiagnosticSeverity.Error,
          undefined,
          'bash-language-server',
        ),
      )
      return
    }

    if (TreeSitterUtil.isDefinition(node)) {
      const symbol = nodeToSymbolInformation({ node, uri })

      if (symbol) {
        const word = symbol.name
        globalDeclarations[word] = symbol
      }
    }
  })

  return { diagnostics, globalDeclarations }
}

/**
 * Returns all declarations (functions or variables) from a given tree.
 * This includes local variables.
 */
export function getAllDeclarationsInTree({
  tree,
  uri,
}: {
  tree: Parser.Tree
  uri: string
}): LSP.SymbolInformation[] {
  const symbols: LSP.SymbolInformation[] = []

  TreeSitterUtil.forEach(tree.rootNode, (node) => {
    if (TreeSitterUtil.isDefinition(node)) {
      const symbol = nodeToSymbolInformation({ node, uri })

      if (symbol) {
        symbols.push(symbol)
      }
    }

    return
  })

  return symbols
}

/**
 * Returns declarations available for the given file and location.
 * The heuristics used is a simplification compared to bash behaviour,
 * but deemed good enough, compared to the complexity of flow tracing.
 *
 * Used when getting declarations for the current scope.
 */
export function getLocalDeclarations({
  node,
  uri,
}: {
  node: Parser.SyntaxNode | null
  uri: string
}): Declarations {
  const declarations: Declarations = {}

  // Bottom up traversal to capture all local and scoped declarations
  const walk = (node: Parser.SyntaxNode | null) => {
    // NOTE: there is also node.walk
    if (node) {
      for (const childNode of node.children) {
        let symbol: LSP.SymbolInformation | null = null

        // local variables
        if (childNode.type === 'declaration_command') {
          const variableAssignmentNode = childNode.children.filter(
            (child) => child.type === 'variable_assignment',
          )[0]

          if (variableAssignmentNode) {
            symbol = nodeToSymbolInformation({
              node: variableAssignmentNode,
              uri,
            })
          }
        } else if (TreeSitterUtil.isDefinition(childNode)) {
          symbol = nodeToSymbolInformation({ node: childNode, uri })
        } else if (childNode.type === 'for_statement') {
          const variableNode = childNode.child(1)
          if (variableNode && variableNode.type === 'variable_name') {
            symbol = LSP.SymbolInformation.create(
              variableNode.text,
              LSP.SymbolKind.Variable,
              TreeSitterUtil.range(variableNode),
              uri,
            )
          }
        }

        if (symbol) {
          if (!declarations[symbol.name]) {
            declarations[symbol.name] = []
          }
          declarations[symbol.name].push(symbol)
        }
      }

      walk(node.parent)
    }
  }

  walk(node)

  // Top down traversal to add missing global variables from within functions
  if (node) {
    const rootNode =
      node.type === 'program'
        ? node
        : TreeSitterUtil.findParent(node, (p) => p.type === 'program')
    if (!rootNode) {
      throw new Error('did not find root node')
    }

    Object.entries(
      getAllGlobalVariableDeclarations({
        rootNode,
        uri,
      }),
    ).map(([name, symbols]) => {
      if (!declarations[name]) {
        declarations[name] = symbols
      }
    })
  }

  return declarations
}

function getAllGlobalVariableDeclarations({
  uri,
  rootNode,
}: {
  uri: string
  rootNode: Parser.SyntaxNode
}) {
  const declarations: Declarations = {}

  TreeSitterUtil.forEach(rootNode, (node) => {
    if (
      node.type === 'variable_assignment' &&
      // exclude local variables
      node.parent?.type !== 'declaration_command'
    ) {
      const symbol = nodeToSymbolInformation({ node, uri })
      if (symbol) {
        if (!declarations[symbol.name]) {
          declarations[symbol.name] = []
        }
        declarations[symbol.name].push(symbol)
      }
    }

    return
  })

  return declarations
}

function nodeToSymbolInformation({
  node,
  uri,
}: {
  node: Parser.SyntaxNode
  uri: string
}): LSP.SymbolInformation | null {
  const named = node.firstNamedChild

  if (named === null) {
    return null
  }

  const containerName =
    TreeSitterUtil.findParent(node, (p) => p.type === 'function_definition')
      ?.firstNamedChild?.text || ''

  const kind = TREE_SITTER_TYPE_TO_LSP_KIND[node.type]

  return LSP.SymbolInformation.create(
    named.text,
    kind || LSP.SymbolKind.Variable,
    TreeSitterUtil.range(node),
    uri,
    containerName,
  )
}
