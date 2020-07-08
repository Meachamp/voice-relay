const Discord = require('discord.js')
const client = new Discord.Client()
const prism = require('prism-media')
const { OpusEncoder } = require('@discordjs/opus')
const dgram = require('dgram')
const server = dgram.createSocket('udp4')
const AudioMixer = require('audio-mixer')
const {Readable} = require('stream')
const fs = require('fs')

let encoders = {}
let mixer = new AudioMixer.Mixer({
    channels: 1,
    bitDepth: 16,
    sampleRate: 24000,
//This will cause a 100ms delay between real game time and relay transmission for synchronization.
    clearInterval: 100 
});

let createInput = () => {
    return mixer.input({
        channels: 1,
        sampleRate: 24000,
        bitDepth: 1
    })
}

let createReadable = () => {
    let readable = new Readable()
    readable._read = () => {}
    return readable
}

let ct = (obj) => {
    var size = 0, key;
    for (key in obj) {
        if (obj.hasOwnProperty(key)) size++;
    }
    return size;
};
let processPckt = (buf) => {

    let readPos = 0
    
    let id64 = buf.readBigInt64LE(readPos)
    readPos += 8

    if(!encoders[id64]) {
        let input = createInput()
        encoders[id64] = {encoder:new OpusEncoder(24000, 1), stream:createReadable(), mix:input}
        encoders[id64].stream.pipe(input)
        encoders[id64].time = Date.now()/1000
    }
    
    let readable = encoders[id64].stream
    let encoder = encoders[id64].encoder
    console.log(`Packet header decoded from steamid64 ${id64}. LEN: ${buf.length}`)
    
    fs.writeFileSync('pck.dat', buf)

    const maxRead = buf.length
    let frames = []

    while(readPos < maxRead - 4) {
        let len = buf.readUInt16LE(readPos)
        readPos += 2
        
        let seq = buf.readUInt16LE(readPos)
        readPos += 2
        //console.log(`Frame init: ${len}, ${seq}`)
        if(len <= 0 || seq < 0 || len > 1000 || seq > 2000) { 
            //I'm probably bad at math somewhere. 
            //This works for now to prevent segfaults at least
            console.log(`Invalid packet LEN: ${len}, SEQ: ${seq}`)
            return
        }

        const data = buf.slice(readPos, readPos + len)
        readPos += len

        frames.push(encoder.decode(data))
    }

    let decompressedData = Buffer.concat(frames)
    readable.push(decompressedData)
}

let gcEncoders = () => {
    let curtime = Date.now()/1000
    Object.keys(encoders).forEach(function (k) { 
        let encoderData = encoders[k]
        if(encoderData.time + 15 < curtime) {
            mixer.removeInput(encoders[k].mix)
            delete encoders[k].stream
            delete encoders[k].encoder
            delete encoders[k].mix
            delete encoders[k]
            console.log('gc')
        }
    })
}
setInterval(gcEncoders, 5000)

let playOpusStream = (t, stream, options, streams = {}) => {
    t.destroyDispatcher()
    streams.opus = stream
    if (options.volume !== false && !streams.input) {
      streams.input = stream
      streams.volume = new prism.VolumeTransformer({ type: 's16le', volume: options ? options.volume : 1 })
      streams.opus = stream
        .pipe(streams.volume)
        .pipe(new prism.opus.Encoder({ channels: 1, rate: 24000, frameSize: 480 }))
    }
    const dispatcher = t.createDispatcher(options, streams)
    streams.opus.pipe(dispatcher)
    return dispatcher
}

client.on('ready', async () => {
    console.log('Started discord client.');
    let chan = await client.channels.fetch(process.env.CHANNEL_ID)
    const conn = await chan.join()
    playOpusStream(conn.player, mixer, {}, {})
})
client.login(process.env.DISCORD_TOKEN)

server.on('error', (err) => {
    console.log(`server error:\n${err.stack}`)
    server.close()
})

server.on('message', (msg, rinfo) => {
    try {
        processPckt(msg)
    } catch(e) {
        console.log(`Voice packet decode failed for ${rinfo.address}:${rinfo.port}`)
        console.log(e)
    }
})

server.on('listening', () => {
    const address = server.address()
    console.log(`UDP socket listening ${address.address}:${address.port}`)
})

server.bind(process.env.PORT || 4000)