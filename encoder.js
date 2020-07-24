const crc = require('crc-32')


//Takes an encoder instance and an input buffer of pcm samples
//Will mutate the output buffer in place and return bytes written

const FRAME_SIZE = 480
let encodeOpusFrames = (encoder, inputBuf, outputBuf) => {
    let writePos = 0
    let readPos = 0
    
    let seq = 0

    while(readPos < inputBuf.length) {
        let endPos = Math.min(inputBuf.length, readPos + FRAME_SIZE*2)
        let samples = inputBuf.subarray(readPos, endPos)

        let compressedData = encoder.encode(samples)
        readPos += endPos - readPos

        //frame length
        outputBuf.writeUInt16LE(compressedData.length, writePos)
        writePos += 2

        //seq id
        outputBuf.writeUInt16LE(seq, writePos)
        writePos += 2

        //Copy in compressed data
        writePos += compressedData.copy(outputBuf, writePos)

        seq += 1
    }
	
	return writePos
}

let buf = Buffer.alloc(10*1024)
let encodeSteamPacket = (steamid, encoder, inputBuf) => {
	let writePos = 0
	
	//write steamid
	buf.writeBigInt64LE(steamid, writePos)
	writePos += 8
	
	//set samplerate to 24000
	buf.writeUInt8(opcodes.OP_SAMPLERATE, writePos)
	writePos += 1
	buf.writeUInt16LE(24000, writePos)
	writePos += 2
	
	//write codec op
	buf.writeUInt8(opcodes.OP_CODEC_OPUSPLC, writePos)
	writePos += 1
	
	//Write frame total length and frame data
	let frameField = writePos
	writePos += 2
	
	let frameLen = encodeOpusFrames(encoder, inputBuf, buf.subarray(writePos))
	writePos += frameLen
	
	buf.writeUInt16LE(frameLen, frameField)
	
	//write checksum
	buf.writeInt32LE(crc.buf(buf.subarray(0, writePos)), writePos)
	writePos += 4
	
	return buf.subarray(0, writePos)
}

let encoder = getEncoder()
let fil = fs.readFileSync('sample.raw')

for(let i = 0; i < 100; i++) {
    let buf = fil.slice(i * 960, i*960 + 960)
    fs.writeFileSync(`data/test${i}.dat`, encodeSteamPacket(123n, encoder, buf))
}

//fs.writeFileSync('test.dat', encodeSteamPacket(1234n, encoder, Buffer.alloc(960)))