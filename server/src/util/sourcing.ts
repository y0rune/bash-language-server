import * as fs from 'fs'
import * as path from 'path'
import * as LSP from 'vscode-languageserver'
import * as Parser from 'web-tree-sitter'

import { untildify } from './fs'
import { logger } from './logger'
import * as TreeSitterUtil from './tree-sitter'

const SOURCING_COMMANDS = ['source', '.']

export type SourceCommand = {
  range: LSP.Range
  uri: string | null // resolved URIs
  error: string | null
}

/**
 * Analysis the given tree for source commands.
 */
export function getSourceCommands({
  fileUri,
  rootPath,
  tree,
}: {
  fileUri: string
  rootPath: string | null
  tree: Parser.Tree
}): SourceCommand[] {
  const sourceCommands: SourceCommand[] = []

  const rootPaths = [path.dirname(fileUri), rootPath].filter(Boolean) as string[]

  TreeSitterUtil.forEach(tree.rootNode, (node) => {
    const sourcedPathInfo = getSourcedPathInfoFromNode({ node })

    if (sourcedPathInfo) {
      const { sourcedPath, parseError } = sourcedPathInfo
      const uri = sourcedPath ? resolveSourcedUri({ rootPaths, sourcedPath }) : null

      sourceCommands.push({
        range: TreeSitterUtil.range(node),
        uri,
        error: uri ? null : parseError || 'failed to resolve path',
      })
    }

    return true
  })

  return sourceCommands
}

function getSourcedPathInfoFromNode({
  node,
}: {
  node: Parser.SyntaxNode
}): null | { sourcedPath?: string; parseError?: string } {
  if (node.type === 'command') {
    const [commandNameNode, argumentNode] = node.namedChildren
    if (
      commandNameNode.type === 'command_name' &&
      SOURCING_COMMANDS.includes(commandNameNode.text)
    ) {
      if (argumentNode.type === 'word') {
        return {
          sourcedPath: argumentNode.text,
        }
      }

      if (argumentNode.type === 'simple_expansion') {
        return {
          parseError: 'expansion not supported',
        }
      }

      if (argumentNode.type === 'string') {
        if (argumentNode.namedChildren.length === 0) {
          return {
            sourcedPath: argumentNode.text.slice(1, -1),
          }
        } else if (
          argumentNode.namedChildren.every((n) => n.type === 'simple_expansion')
        ) {
          return {
            parseError: 'expansion not supported',
          }
        } else {
          logger.warn(
            'Sourcing: unhandled argumentNode=string case',
            argumentNode.namedChildren.map((c) => ({ type: c.type, text: c.text })),
          )
        }
      } else {
        logger.warn(`Sourcing: unhandled argumentNode=${argumentNode.type} case`)
      }

      return {
        parseError: `unhandled case node type "${argumentNode.type}"`,
      }
    }
  }

  return null
}

/**
 * Tries to resolve the given sourced path and returns a URI if possible.
 * - Converts a relative paths to absolute paths
 * - Converts a tilde path to an absolute path
 * - Resolves the path
 *
 * NOTE: for future improvements:
 * "If filename does not contain a slash, file names in PATH are used to find
 *  the directory containing filename." (see https://ss64.com/osx/source.html)
 */
function resolveSourcedUri({
  rootPaths,
  sourcedPath,
}: {
  rootPaths: string[]
  sourcedPath: string
}): string | null {
  if (sourcedPath.startsWith('~')) {
    sourcedPath = untildify(sourcedPath)
  }

  if (sourcedPath.startsWith('/')) {
    if (fs.existsSync(sourcedPath)) {
      return `file://${sourcedPath}`
    }
    return null
  }

  // resolve  relative path
  for (const rootPath of rootPaths) {
    const potentialPath = path.join(rootPath.replace('file://', ''), sourcedPath)

    // check if path is a file
    if (fs.existsSync(potentialPath)) {
      return `file://${potentialPath}`
    }
  }

  return null
}
