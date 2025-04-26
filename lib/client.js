const {
    default: makeWASocket,
    useSingleFileAuthState,
    DisconnectReason,
    fetchLatestBaileysVersion,
    makeInMemoryStore
} = require('@whiskeysockets/baileys')
const { Boom } = require('@hapi/boom')
const fs = require('fs')
const path = require('path')
const pino = require('pino')
const chalk = require('chalk')
const { smsg } = require('./lib/myfunc')
const FileType = require('file-type')
const fetch = require('node-fetch')
const { imageToWebp, videoToWebp, writeExifImg, writeExifVid } = require('./lib/exif')

const store = makeInMemoryStore({ logger: pino().child({ level: 'silent', stream: 'store' }) })
store.readFromFile('./baileys_store.json')
setInterval(() => {
    store.writeToFile('./baileys_store.json')
}, 10_000)

const SESSION_PATH = './session.json'

// Handle SESSION_DATA from env
if (process.env.SESSION_DATA) {
    const data = Buffer.from(process.env.SESSION_DATA, 'base64').toString('utf-8')
    fs.writeFileSync(SESSION_PATH, data)
}

const { state, saveCreds } = useSingleFileAuthState(SESSION_PATH)

async function startBot() {
    const { version, isLatest } = await fetchLatestBaileysVersion()
    const sock = makeWASocket({
        version,
        logger: pino({ level: 'silent' }),
        printQRInTerminal: true,
        auth: state
    })

    store.bind(sock.ev)

    sock.ev.on('creds.update', saveCreds)

    sock.ev.on('messages.upsert', async ({ messages, type }) => {
        const msg = messages[0]
        if (!msg.message) return
        if (msg.key && msg.key.remoteJid === 'status@broadcast') return
        msg.message = (Object.keys(msg.message)[0] === 'ephemeralMessage') ? msg.message.ephemeralMessage.message : msg.message
        const m = smsg(sock, msg, store)
        require('./main')(sock, m, msg, store)
    })

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect } = update
        if (connection === 'close') {
            let reason = new Boom(lastDisconnect?.error)?.output?.statusCode
            if (reason === DisconnectReason.badSession) {
                console.log(`Bad Session File, Please Delete session and Scan Again`)
            } else if (reason === DisconnectReason.connectionClosed) {
                console.log("Connection closed, reconnecting...")
                startBot()
            } else if (reason === DisconnectReason.connectionLost) {
                console.log("Connection lost from server, reconnecting...")
                startBot()
            } else if (reason === DisconnectReason.connectionReplaced) {
                console.log("Connection Replaced, Another New Session Opened, Please Close Current Session First")
            } else if (reason === DisconnectReason.loggedOut) {
                console.log("Device Logged Out, Please Scan Again And Run.")
            } else if (reason === DisconnectReason.restartRequired) {
                console.log("Restart Required, Restarting...")
                startBot()
            } else if (reason === DisconnectReason.timedOut) {
                console.log("Connection TimedOut, Reconnecting...")
                startBot()
            } else {
                console.log(`Unknown DisconnectReason: ${reason}|${connection}`)
            }
        } else if (connection === "open") {
            console.log("Bot connected")
        }
    })

    // Print SESSION_DATA after successful login
    if (!process.env.SESSION_DATA && fs.existsSync(SESSION_PATH)) {
        const creds = fs.readFileSync(SESSION_PATH, 'utf-8')
        const encoded = Buffer.from(creds).toString('base64')
        console.log('\nSESSION_DATA=' + encoded + '\n')
    }

    return sock
}

startBot()
