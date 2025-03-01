import BashLanguageServer from 'bash-language-server'
import {
  createConnection,
  InitializeParams,
  InitializeResult,
  ProposedFeatures,
} from 'vscode-languageserver/node'

const connection = createConnection(ProposedFeatures.all)

connection.onInitialize(async (params: InitializeParams): Promise<InitializeResult> => {
  const server = await BashLanguageServer.initialize(connection, params)
  server.register(connection)
  return {
    capabilities: server.capabilities(),
  }
})

connection.listen()

// Don't die on unhandled Promise rejections
process.on('unhandledRejection', (reason, p) => {
  connection.console.error(`Unhandled Rejection at promise: ${p}, reason: ${reason}`)
})

process.on('SIGPIPE', () => {
  // Don't die when attempting to pipe stdin to a bad spawn
  // https://github.com/electron/electron/issues/13254
})
