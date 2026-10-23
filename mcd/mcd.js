/*
* Mega CD / Sega CD implementation for Memory Card Manager JS
*
* Released under no license, feel free to do whatever you want with it without restrictions
*/

/*
	File format specification (reverse engineered by Ian Karlsson):
	https://github.com/superctr/buram
	https://github.com/ekeeke/Genesis-Plus-GX (brm_format)

	Backup RAM is split in 64-byte blocks. Block 0 is reserved and the last block is the footer.
	Files are stored contiguously from block 1, the directory grows backwards from the footer
	(16-byte entries, two per block). Directory blocks and "protected" files are stored with
	ECC: 32 bytes of data per 64-byte block, with a CRC-16 and two Reed-Solomon codes.
*/

const BLOCK_SIZE=0x40;
const DEFAULT_SIZE=0x2000;
const CART_SIZE=0x20000;
const VALID_SIZES=[0x2000, 0x4000, 0x8000, 0x10000, 0x20000, 0x40000, 0x80000];
const RESERVED_BLOCKS=3; //first block, footer and the first directory block

const FOOTER_SIZE=0x40;
const FOOTER_FREE_BLOCKS=0x10; //4 repeated u16
const FOOTER_NUM_FILES=0x18; //4 repeated u16
const FOOTER_SIGNATURE=0x20;
const FOOTER_TEMPLATE=[
	0x5f,0x5f,0x5f,0x5f,0x5f,0x5f,0x5f,0x5f,0x5f,0x5f,0x5f,0x00,0x00,0x00,0x00,0x40,
	0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,
	0x53,0x45,0x47,0x41,0x5f,0x43,0x44,0x5f,0x52,0x4f,0x4d,0x00,0x01,0x00,0x00,0x00,
	0x52,0x41,0x4d,0x5f,0x43,0x41,0x52,0x54,0x52,0x49,0x44,0x47,0x45,0x5f,0x5f,0x5f
];

const DIRECTORY_ENTRY_SIZE=0x10;
const DIRECTORY_ENTRY_FILENAME=0x00;
const DIRECTORY_ENTRY_ECC=0x0b;
const DIRECTORY_ENTRY_FIRST_BLOCK=0x0c;
const DIRECTORY_ENTRY_FILESIZE=0x0e; //in blocks
const FILENAME_SIZE=11;
const ECC_ENABLED=0xff;
const ECC_BLOCK_DATA_SIZE=0x20;




const SYSTEM={
	id:'mcd',
	slotLetters:true,
	validExtensions:'.brm,.scd',
	exampleFile:'example.brm',
	defaultIconFile:'slot.png',
	differentSizes:true,
	infoFields:[
		'eccStatus',
		'byteSizeText'
	],
	editableFields:[
		'fileName'
	]
}














function MemoryCard(arrayBuffer, name){
	this.unsavedChanges=false;
	this._rawData=new BinaryReader(arrayBuffer? arrayBuffer : DEFAULT_SIZE, typeof name==='string'? name : 'memcard.brm');
	this.byteSize=this._rawData.size;
	this.size=this.byteSize / BLOCK_SIZE - RESERVED_BLOCKS; //usable blocks

	this.content=[];

	if(!arrayBuffer)
		this._rawData.writeBytesAt(this.byteSize - FOOTER_SIZE, FOOTER_TEMPLATE);

	this.buildRawData();
}
MemoryCard.fromArrayBuffer=function(arrayBuffer, name){
	var rawFile=new BinaryReader(arrayBuffer);

	if(VALID_SIZES.indexOf(rawFile.size)===-1)
		return null;

	var footerOffset=rawFile.size - FOOTER_SIZE;
	for(var i=FOOTER_SIGNATURE; i<FOOTER_SIZE; i++){
		if(rawFile.readU8At(footerOffset + i)!==FOOTER_TEMPLATE[i])
			return null;
	}
	var numFiles=readRepeatedU16(rawFile, footerOffset + FOOTER_NUM_FILES);
	if(numFiles<0 || numFiles>rawFile.size / BLOCK_SIZE)
		return null;

	var memoryCard=new MemoryCard(rawFile._u8array.buffer.slice(0), name);

	memoryCard.content=[];
	for(var i=0; i<numFiles; i++){
		//each directory block holds two 16-byte entries
		var entryOffset=directoryEntryOffset(footerOffset, i);
		var blockOffset=entryOffset - (entryOffset % BLOCK_SIZE);
		var directoryBlock=Ecc.decode(rawFile._u8array.subarray(blockOffset, blockOffset + BLOCK_SIZE));
		var dataOffset=(entryOffset - blockOffset) / 2;
		var entry=directoryBlock.data.slice(dataOffset, dataOffset + DIRECTORY_ENTRY_SIZE);

		var useEcc=entry[DIRECTORY_ENTRY_ECC]!==0;
		var firstBlock=(entry[DIRECTORY_ENTRY_FIRST_BLOCK] << 8) | entry[DIRECTORY_ENTRY_FIRST_BLOCK + 1];
		var size=(entry[DIRECTORY_ENTRY_FILESIZE] << 8) | entry[DIRECTORY_ENTRY_FILESIZE + 1];
		if(size<1 || firstBlock<1 || (firstBlock + size) * BLOCK_SIZE>footerOffset)
			continue;

		var blockDataSize=useEcc? ECC_BLOCK_DATA_SIZE : BLOCK_SIZE;
		var file=new BinaryReader(DIRECTORY_ENTRY_SIZE + size * blockDataSize);
		file._u8array.set(entry, 0);
		for(var j=0; j<size; j++){
			var offset=(firstBlock + j) * BLOCK_SIZE;
			var data=useEcc?
				Ecc.decode(rawFile._u8array.subarray(offset, offset + BLOCK_SIZE)).data :
				rawFile._u8array.subarray(offset, offset + BLOCK_SIZE)
			;
			file._u8array.set(data, DIRECTORY_ENTRY_SIZE + j * blockDataSize);
		}

		var newContent=new Content(file._u8array.buffer);
		newContent._rawData.name=newContent.fileName+'.scd';
		memoryCard.content.push(newContent);
	}
	return memoryCard;
}
MemoryCard.prototype.buildRawData=function(){
	var raw=this._rawData;
	var footerOffset=this.byteSize - FOOTER_SIZE;

	//files are stored contiguously from block 1
	var nextBlock=1;
	var totalFileBlocks=0;
	for(var i=0; i<this.content.length; i++){
		var content=this.content[i];
		content.firstDataBlock=nextBlock;
		content.buildRawData();

		var blockDataSize=content.useEcc? ECC_BLOCK_DATA_SIZE : BLOCK_SIZE;
		for(var j=0; j<content.size; j++){
			var data=content._rawData._u8array.subarray(
				DIRECTORY_ENTRY_SIZE + j * blockDataSize,
				DIRECTORY_ENTRY_SIZE + (j + 1) * blockDataSize
			);
			raw._u8array.set(content.useEcc? Ecc.encode(data) : data, (nextBlock + j) * BLOCK_SIZE);
		}
		nextBlock+=content.size;
		totalFileBlocks+=content.size;
	}

	//directory, two entries per block growing backwards from the footer
	var directoryBlocks=Math.ceil(this.content.length / 2);
	var directoryOffset=footerOffset - directoryBlocks * BLOCK_SIZE;
	raw.seek(nextBlock * BLOCK_SIZE);
	raw.fill(directoryOffset - nextBlock * BLOCK_SIZE, 0x00);
	for(var i=0; i<directoryBlocks; i++){
		var payload=new Uint8Array(ECC_BLOCK_DATA_SIZE);
		for(var j=0; j<2 && i * 2 + j<this.content.length; j++){
			//even entries go to the upper half of the block
			payload.set(this.content[i * 2 + j]._rawData._u8array.subarray(0, DIRECTORY_ENTRY_SIZE), j===0? DIRECTORY_ENTRY_SIZE : 0);
		}
		raw._u8array.set(Ecc.encode(payload), footerOffset - (i + 1) * BLOCK_SIZE);
	}

	//footer counters
	for(var i=0; i<4; i++){
		raw.writeU16At(footerOffset + FOOTER_FREE_BLOCKS + i * 2, this.getFreeBlocks());
		raw.writeU16At(footerOffset + FOOTER_NUM_FILES + i * 2, this.content.length);
	}

	return raw._u8array.buffer;
}
MemoryCard.prototype.getFreeBlocks=function(){
	return MemoryCard.calculateFreeBlocks(this.size, this.content);
}
MemoryCard.calculateFreeBlocks=function(size, contents){
	var freeBlocks=size - Math.floor(contents.length / 2);
	for(var i=0; i<contents.length; i++){
		freeBlocks-=contents[i].size;
	}
	return freeBlocks;
}
MemoryCard.prototype.info=function(){
	var freeBlocks=this.getFreeBlocks();

	return {
		valid:false,
		checksum:0x00,
		freeBlocks: freeBlocks,
		usage: Math.round(((this.size - freeBlocks) / this.size) * 100),
		summary: UI.getFreeBlocksString(freeBlocks)
	}
}

MemoryCard.prototype.export=function(){
	this.buildRawData();

	var rawFile=this._rawData.slice();
	rawFile.name=this._rawData.name;
	return rawFile;
}

MemoryCard.prototype.importContent=function(content){
	//a file with the same name is replaced
	var contents=this.content.slice();
	var existingIndex=-1;
	for(var i=0; i<contents.length; i++){
		if(contents[i].fileName===content.fileName){
			existingIndex=i;
			break;
		}
	}
	if(existingIndex!==-1)
		contents[existingIndex]=content;
	else
		contents.push(content);

	if(MemoryCard.calculateFreeBlocks(this.size, contents)<0)
		return false;

	this.content=contents;
	return true;
}

MemoryCard.prototype.format=function(type){
	const newByteSize=type==='cart'? CART_SIZE : DEFAULT_SIZE;
	const changeSize=(newByteSize!==this.byteSize);

	if(this.content.length || changeSize)
		this.unsavedChanges=true;

	if(changeSize){
		this._rawData=new BinaryReader(newByteSize, this._rawData.name);
		this.byteSize=newByteSize;
		this.size=newByteSize / BLOCK_SIZE - RESERVED_BLOCKS;
		this._rawData.writeBytesAt(newByteSize - FOOTER_SIZE, FOOTER_TEMPLATE);
	}
	this.content=[];
}

MemoryCard.prototype.deleteContent=function(content){
	var index=this.content.indexOf(content);
	if(index!==-1){
		this.content.splice(index, 1);
		return content;
	}
	return null;
}






/*
	Content._rawData is a 16-byte directory entry followed by the file data (without ECC).
	It is also the format of exported .scd files.
*/
function Content(arrayBuffer){
	this._rawData=new BinaryReader(arrayBuffer);

	/* parse data */
	this.fileName=Content.readFileName(this._rawData);
	this.useEcc=this._rawData.readU8At(DIRECTORY_ENTRY_ECC)!==0;
	this.firstDataBlock=this._rawData.readU16At(DIRECTORY_ENTRY_FIRST_BLOCK);
	this.size=this._rawData.readU16At(DIRECTORY_ENTRY_FILESIZE);

	this.byteSize=this.size * (this.useEcc? ECC_BLOCK_DATA_SIZE : BLOCK_SIZE);
	this.byteSizeText=this.byteSize+' bytes';
	this.eccStatus=this.useEcc? 'Protected (ECC)' : 'Not protected';

	this.icon=new ContentIcon(SYSTEM.defaultIconImageData? [SYSTEM.defaultIconImageData] : []);
}
Content.fromArrayBuffer=function(arrayBuffer){
	var file=new BinaryReader(arrayBuffer);

	if(file.size<DIRECTORY_ENTRY_SIZE + ECC_BLOCK_DATA_SIZE)
		return null;

	var eccFlag=file.readU8At(DIRECTORY_ENTRY_ECC);
	var size=file.readU16At(DIRECTORY_ENTRY_FILESIZE);
	if(
		(eccFlag===0x00 || eccFlag===ECC_ENABLED) && size>=1 &&
		file.size - DIRECTORY_ENTRY_SIZE === size * (eccFlag? ECC_BLOCK_DATA_SIZE : BLOCK_SIZE)
	)
		return new Content(arrayBuffer);

	return null;
}
Content.readFileName=function(rawData){
	var name='';
	for(var i=0; i<FILENAME_SIZE; i++){
		var c=String.fromCharCode(rawData.readU8At(DIRECTORY_ENTRY_FILENAME + i));
		name+=/[A-Z0-9*]/.test(c)? c : '_';
	}
	return name.replace(/_+$/, '');
}

Content.prototype.export=function(){
	this.buildRawData();

	return this._rawData.slice();
}
Content.prototype.buildRawData=function(){
	this._rawData.writeU16At(DIRECTORY_ENTRY_FIRST_BLOCK, this.firstDataBlock);

	this._rawData.name=(this.fileName || 'BACKUP')+'.scd';
	return this._rawData._u8array.buffer;
}
Content.prototype.info=function(){
	var summary=UI.getBlocksString(this.size);
	if(this.useEcc)
		summary+=' ECC';

	return {
		region:REGION_UNKNOWN,
		blocks:this.size,
		name:UI.escapeHTML(this.fileName || '-'),
		summary:summary
	};
}

Content.prototype.setFileName=function(fileName){
	if(typeof fileName !== 'string')
		return false;

	var name=fileName.toUpperCase().replace(/[^A-Z0-9_]/g, '_').substr(0, FILENAME_SIZE);
	this._rawData.writeStringAt(DIRECTORY_ENTRY_FILENAME, name.padEnd(FILENAME_SIZE, '_'), FILENAME_SIZE);
	this.fileName=Content.readFileName(this._rawData);
}





/* helper functions */
/* ECC (CRC-16 + two Reed-Solomon codes), ported from buram */
const Ecc=(function(){
	const RS6_LAST_DATA_BYTE=[0x2d, 0x2e, 0x2f, 0x08, 0x11, 0x1a, 0x23, 0x2c];

	function ReedSolomon(poly, symbolSize, polygen){
		this.polygen=polygen;
		this.nn=(1 << symbolSize) - 1;
		this.indexOf=new Uint8Array(256);
		this.alphaTo=new Uint8Array(256);
		for(var i=1, sr=1; i<=this.nn; i++){
			this.indexOf[sr]=i;
			this.alphaTo[i]=sr;
			sr<<=1;
			if(sr & (1 << symbolSize))
				sr^=poly;
			sr&=this.nn;
		}
	}
	ReedSolomon.prototype.addMod=function(i, d){
		d+=this.polygen[i];
		while(d>=this.nn)
			d-=this.nn;
		return this.alphaTo[d + 1];
	}
	ReedSolomon.prototype.encode=function(data){
		data[6]=0;
		data[7]=0;
		for(var i=0; i<6; i++){
			var d=data[i];
			if(d){
				d=this.indexOf[d] - 1;
				data[6]^=this.addMod(i, d);
				data[7]^=this.addMod(i + 6, d);
			}
		}
	}
	ReedSolomon.prototype.decode=function(data){
		var errorMask=0;
		var errorLoc=0;
		for(var i=0; i<8; i++){
			var d=data[i];
			errorMask^=d;
			if(d){
				d=this.indexOf[d] + 6 - i;
				while(d>=this.nn)
					d-=this.nn;
				errorLoc^=this.alphaTo[d + 1];
			}
		}

		if(errorMask){
			var d=this.nn + this.indexOf[errorLoc] - this.indexOf[errorMask];
			while(d>=this.nn)
				d-=this.nn;
			if(d<8){
				data[7 - d]^=errorMask;
				return 0; //single error corrected
			}
			return 1; //uncorrectable
		}
		return 0;
	}

	const rs8=new ReedSolomon(0x1d, 8, [87, 166, 113, 75, 198, 25, 167, 114, 76, 199, 26, 1]);
	const rs6=new ReedSolomon(3, 6, [20, 58, 56, 18, 26, 6, 59, 57, 19, 27, 7, 1]);

	const crcTable=new Array(256);
	for(var i=0; i<256; i++){
		var d=i << 8;
		for(var j=0; j<8; j++)
			d=((d << 1) ^ ((d & 0x8000)? 0x1021 : 0)) & 0xffff;
		crcTable[i]=d;
	}
	function crc16(data, offset){
		var d=0;
		for(var i=0; i<ECC_BLOCK_DATA_SIZE; i++)
			d=((d << 8) ^ crcTable[data[offset + i] ^ (d >> 8)]) & 0xffff;
		return d;
	}

	function interleaveData(input, output){
		var o=0;
		for(var i=0; i<36; i+=3){
			var a=input[i], b=input[i + 1], c=input[i + 2];
			output[o++]=a;
			output[o++]=((a << 8 | b) >> 2) & 0xff;
			output[o++]=((b << 8 | c) >> 4) & 0xff;
			output[o++]=(c << 2) & 0xff;
		}
	}
	function deinterleaveData(input, output){
		var p=0;
		for(var o=0; o<36; o+=3){
			var sr=input[p++] << 6;
			sr=(sr & 0xff00) | input[p++];
			output[o]=(sr >> 6) & 0xff;
			sr=(sr << 6) & 0xffff;
			sr=(sr & 0xff00) | input[p++];
			output[o + 1]=(sr >> 4) & 0xff;
			sr=(sr << 6) & 0xffff;
			sr=(sr & 0xff00) | input[p++];
			output[o + 2]=(sr >> 2) & 0xff;
		}
	}

	function interleaveRs6(block, input, output){
		for(var i=0; i<5; i++)
			output[block + i * 9]=(input[i] << 2) & 0xff;
		output[RS6_LAST_DATA_BYTE[block]]=(input[5] << 2) & 0xff;
		output[0x30 + block]=(input[6] << 2) & 0xff;
		output[0x38 + block]=(input[7] << 2) & 0xff;
	}
	function deinterleaveRs6(block, input, output){
		for(var i=0; i<5; i++)
			output[i]=input[block + i * 9] >> 2;
		output[5]=input[RS6_LAST_DATA_BYTE[block]] >> 2;
		output[6]=input[0x30 + block] >> 2;
		output[7]=input[0x38 + block] >> 2;
	}
	function interleaveRs8(block, input, output){
		for(var i=0; i<8; i++){
			var tmp=input[i];
			for(var j=0; j<8; j++){
				output[block + j * 8]=((output[block + j * 8] << 1) | (tmp >> 7)) & 0xff;
				tmp=(tmp << 1) & 0xff;
			}
		}
	}
	function deinterleaveRs8(block, input, output){
		for(var i=0; i<8; i++){
			var tmp=input[block + i * 8];
			for(var j=0; j<8; j++){
				output[j]=((output[j] << 1) | (tmp >> 7)) & 0xff;
				tmp=(tmp << 1) & 0xff;
			}
		}
	}

	return {
		/* 32 bytes of data -> 64-byte block */
		encode:function(data){
			var buf=new Uint8Array(36);
			buf.set(data.subarray? data.subarray(0, ECC_BLOCK_DATA_SIZE) : data.slice(0, ECC_BLOCK_DATA_SIZE), 2);
			var crc=crc16(buf, 2);
			buf[0]=crc >> 8;
			buf[1]=crc & 0xff;
			buf[34]=~buf[0] & 0xff;
			buf[35]=~buf[1] & 0xff;

			var output=new Uint8Array(BLOCK_SIZE);
			var blockBuf=new Uint8Array(8);
			interleaveData(buf, output);
			for(var block=0; block<8; block++){
				deinterleaveRs6(block, output, blockBuf);
				rs6.encode(blockBuf);
				interleaveRs6(block, blockBuf, output);
			}
			for(var block=0; block<8; block++){
				deinterleaveRs8(block, output, blockBuf);
				rs8.encode(blockBuf);
				interleaveRs8(block, blockBuf, output);
			}
			return output;
		},
		/* 64-byte block -> 32 bytes of data (single-bit errors are corrected) */
		decode:function(block){
			var input=new Uint8Array(BLOCK_SIZE);
			input.set(block);
			var blockBuf=new Uint8Array(8);
			var failed=0;
			for(var b=0; b<8; b++){
				deinterleaveRs8(b, input, blockBuf);
				failed|=rs8.decode(blockBuf);
				interleaveRs8(b, blockBuf, input);
			}
			for(var b=0; b<8; b++){
				deinterleaveRs6(b, input, blockBuf);
				failed|=rs6.decode(blockBuf);
				interleaveRs6(b, blockBuf, input);
			}
			var buf=new Uint8Array(36);
			deinterleaveData(input, buf);

			var crc=crc16(buf, 2);
			if(crc!==((buf[0] << 8) | buf[1]) && crc!==(~((buf[34] << 8) | buf[35]) & 0xffff))
				failed|=2;

			return {data:buf.slice(2, 34), failed:failed};
		}
	}
}());





function readRepeatedU16(rawData, offset){
	var values=[];
	for(var i=0; i<4; i++)
		values.push(rawData.readU16At(offset + i * 2));
	for(var i=0; i<2; i++){
		var count=0;
		for(var j=0; j<4; j++)
			if(values[j]===values[i])
				count++;
		if(count>=3)
			return values[i];
	}
	return -1;
}
function directoryEntryOffset(footerOffset, index){
	return footerOffset - DIRECTORY_ENTRY_SIZE * 2 * (index + 1);
}