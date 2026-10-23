/*
* Sega Saturn implementation for Memory Card Manager JS
*
* Released under no license, feel free to do whatever you want with it without restrictions
*/

/*
	File format specification:
	https://docs.rs/saturn-backup/latest/saturn_backup/
	https://github.com/tpunix/SAROO/blob/master/tools/savetool/bup_format.h (.BUP header)

	Backup memory is split in blocks (64 bytes for the internal memory, 512 for the backup RAM cart).
	Block 0 is the "BackUpRam Format" signature and block 1 is reserved. Each save starts with a block tagged
	0x80000000, carrying its name, comment, date and size, followed by the list of the rest of its blocks and
	then its data. There are no checksums in the filesystem.
*/

const MAGIC=[0x42,0x61,0x63,0x6b,0x55,0x70,0x52,0x61,0x6d,0x20,0x46,0x6f,0x72,0x6d,0x61,0x74]; //BackUpRam Format
const GEOMETRIES={ //total size => block size
	32768:64,
	524288:512
};
const INTERNAL_SIZE=32768;
const CART_SIZE=524288;
const FIRST_DATA_BLOCK=2;
const SAVE_TAG=[0x80,0x00,0x00,0x00];
const CONTINUATION_TAG=[0x00,0x00,0x00,0x00];
const TAG_SIZE=4;
const ENTRY_SIZE=0x22; //tag + name + language + comment + date + size, the block list follows
const NAME_SIZE=11;
const COMMENT_SIZE=10;
const DATE_19800101=315532800000;

const BUP_HEADER_SIZE=0x40;
const BUP_MAGIC='Vmem';
const BUP_OFFSET_SAVE_ID=0x04;
const BUP_OFFSET_NAME=0x10; //12 bytes
const BUP_OFFSET_COMMENT=0x1c; //11 bytes
const BUP_OFFSET_LANGUAGE=0x27;
const BUP_OFFSET_DATE=0x28;
const BUP_OFFSET_DATA_SIZE=0x2c;
const BUP_OFFSET_BLOCKS=0x30;
const BUP_OFFSET_HEADER_DATE=0x34;

const LANGUAGES=['Japanese','English','French','German','Spanish','Italian'];




const SYSTEM={
	id:'ss',
	slotLetters:true,
	validExtensions:'.bkr,.bcr,.bin,.bup',
	exampleFile:'example.bkr',
	defaultIconFile:'slot.png',
	differentSizes:true,
	infoFields:[
		'updateTimestamp',
		'byteSizeText'
	],
	editableFields:[
		'fileName',
		'comment',
		'language'
	]
}








function MemoryCard(arrayBuffer, name, wide){
	this.unsavedChanges=false;
	this._rawData=new BinaryReader(arrayBuffer? arrayBuffer : INTERNAL_SIZE, typeof name==='string'? name : 'memcard.bkr');
	this.wide=!!wide; //each byte is stored on an odd address, preceded by 0xff (Yabause)
	this.setGeometry();

	this.content=[];

	if(!arrayBuffer)
		this.writeSignature();

	this.buildRawData();
}
MemoryCard.fromArrayBuffer=function(arrayBuffer, name){
	var u8=new Uint8Array(arrayBuffer);

	var packed=null;
	var wide=false;
	if(hasMagicAt(u8, 0, 1)){
		packed=u8;
	}else if(u8.length % 2===0 && hasMagicAt(u8, 1, 2)){
		packed=new Uint8Array(u8.length / 2);
		for(var i=0; i<packed.length; i++)
			packed[i]=u8[i * 2 + 1];
		wide=true;
	}
	if(!packed || !GEOMETRIES[packed.length])
		return null;

	var memoryCard=new MemoryCard(packed.slice().buffer, name, wide);

	memoryCard.content=[];
	var blockSize=memoryCard.blockSize;
	var totalBlocks=packed.length / blockSize;
	for(var block=FIRST_DATA_BLOCK; block<totalBlocks; block++){
		if(
			packed[block * blockSize]===SAVE_TAG[0] && packed[block * blockSize + 1]===SAVE_TAG[1] &&
			packed[block * blockSize + 2]===SAVE_TAG[2] && packed[block * blockSize + 3]===SAVE_TAG[3]
		){
			var newContent=Content.readFromVolume(packed, blockSize, block);
			if(newContent){
				newContent.setBlockSize(blockSize);
				memoryCard.content.push(newContent);
			}
		}
	}
	return memoryCard;
}
MemoryCard.prototype.setGeometry=function(){
	this.byteSize=this._rawData.size;
	this.blockSize=GEOMETRIES[this.byteSize];
	this.size=this.byteSize / this.blockSize - FIRST_DATA_BLOCK; //usable blocks
}
MemoryCard.prototype.writeSignature=function(){
	for(var i=0; i<this.blockSize; i+=MAGIC.length)
		this._rawData._u8array.set(MAGIC, i);
}
MemoryCard.prototype.buildRawData=function(){
	var raw=this._rawData._u8array;
	var blockSize=this.blockSize;

	//saves are stored contiguously from block 2, blocks 0 and 1 are left as they are
	var nextBlock=FIRST_DATA_BLOCK;
	for(var i=0; i<this.content.length; i++){
		var content=this.content[i];
		content.setBlockSize(blockSize);
		content.buildRawData();
		var numBlocks=content.size;

		//block list (every block but the first, then a 0x0000 terminator) followed by the data
		var stream=new Uint8Array(numBlocks * 2 + content.dataSize);
		for(var j=1; j<numBlocks; j++){
			stream[(j - 1) * 2]=(nextBlock + j) >> 8;
			stream[(j - 1) * 2 + 1]=(nextBlock + j) & 0xff;
		}
		stream.set(content._rawData._u8array.subarray(BUP_HEADER_SIZE, BUP_HEADER_SIZE + content.dataSize), numBlocks * 2);

		var streamOffset=0;
		for(var j=0; j<numBlocks; j++){
			var blockOffset=(nextBlock + j) * blockSize;
			raw.fill(0x00, blockOffset, blockOffset + blockSize);
			raw.set(j===0? SAVE_TAG : CONTINUATION_TAG, blockOffset);

			var dataOffset=blockOffset + TAG_SIZE;
			if(j===0){
				raw.set(content.getEntry(), dataOffset);
				dataOffset=blockOffset + ENTRY_SIZE;
			}
			var chunk=stream.subarray(streamOffset, streamOffset + (blockOffset + blockSize - dataOffset));
			raw.set(chunk, dataOffset);
			streamOffset+=chunk.length;
		}
		nextBlock+=numBlocks;
	}
	raw.fill(0x00, nextBlock * blockSize);

	return this._rawData._u8array.buffer;
}
MemoryCard.prototype.getFreeBlocks=function(){
	return MemoryCard.calculateFreeBlocks(this.size, this.blockSize, this.content);
}
MemoryCard.calculateFreeBlocks=function(size, blockSize, contents){
	var freeBlocks=size;
	for(var i=0; i<contents.length; i++){
		freeBlocks-=blocksForData(blockSize, contents[i].dataSize);
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

	var rawFile;
	if(this.wide){
		rawFile=new BinaryReader(this.byteSize * 2);
		for(var i=0; i<this.byteSize; i++){
			rawFile._u8array[i * 2]=0xff;
			rawFile._u8array[i * 2 + 1]=this._rawData._u8array[i];
		}
	}else{
		rawFile=this._rawData.slice();
	}
	rawFile.name=this._rawData.name;
	return rawFile;
}

MemoryCard.prototype.importContent=function(content){
	//a save with the same name is replaced
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

	if(MemoryCard.calculateFreeBlocks(this.size, this.blockSize, contents)<0)
		return false;

	content.setBlockSize(this.blockSize);
	this.content=contents;
	return true;
}

MemoryCard.prototype.format=function(type){
	const newByteSize=type==='cart'? CART_SIZE : INTERNAL_SIZE;
	const changeSize=(newByteSize!==this.byteSize);

	if(this.content.length || changeSize)
		this.unsavedChanges=true;

	if(changeSize){
		this._rawData=new BinaryReader(newByteSize, this._rawData.name.replace(/\.(bkr|bcr)$/i, newByteSize===INTERNAL_SIZE? '.bkr' : '.bcr'));
		this.setGeometry();
		this.writeSignature();
		if(newByteSize!==INTERNAL_SIZE)
			this.wide=false;
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
	Content._rawData is a 64-byte .BUP header followed by the save data, which is also the format of exported .bup files.
	The header holds everything the save's first block does, so a save can be moved between volumes of different block sizes.
*/
function Content(arrayBuffer){
	this._rawData=new BinaryReader(arrayBuffer);

	/* parse data */
	this.fileName=readText(this._rawData._u8array, BUP_OFFSET_NAME, NAME_SIZE);
	this.comment=readText(this._rawData._u8array, BUP_OFFSET_COMMENT, COMMENT_SIZE);
	this.language=this._rawData.readU8At(BUP_OFFSET_LANGUAGE);
	this.date=this._rawData.readU32At(BUP_OFFSET_DATE);
	this.dataSize=this._rawData.readU32At(BUP_OFFSET_DATA_SIZE);

	this.updateTimestamp=Content.formatDate(this.date);
	this.byteSizeText=this.dataSize+' bytes';

	this.setBlockSize(GEOMETRIES[INTERNAL_SIZE]);
	this.icon=new ContentIcon(SYSTEM.defaultIconImageData? [SYSTEM.defaultIconImageData] : []);
}
Content.fromArrayBuffer=function(arrayBuffer){
	var file=new BinaryReader(arrayBuffer);

	if(file.size<=BUP_HEADER_SIZE || file.readString(BUP_MAGIC.length)!==BUP_MAGIC)
		return null;

	var dataSize=file.readU32At(BUP_OFFSET_DATA_SIZE);
	if(dataSize<1 || dataSize>file.size - BUP_HEADER_SIZE)
		return null;

	return new Content(file._u8array.slice(0, BUP_HEADER_SIZE + dataSize).buffer);
}
/* reads the save whose first block is `firstBlock`, or null if its block list is broken */
Content.readFromVolume=function(volume, blockSize, firstBlock){
	var totalBlocks=volume.length / blockSize;
	var entryOffset=firstBlock * blockSize;
	var readU32=function(offset){
		return ((volume[offset] << 24) | (volume[offset + 1] << 16) | (volume[offset + 2] << 8) | volume[offset + 3]) >>> 0;
	}
	var dataSize=readU32(entryOffset + 0x1e);

	//the block list and the data are one continuous stream over the content area of each block
	var stream=Array.prototype.slice.call(volume.subarray(entryOffset + ENTRY_SIZE, entryOffset + blockSize));
	var listedBlocks=[firstBlock];
	var position=0;
	while(true){
		if(position + 2>stream.length)
			return null;
		var next=(stream[position] << 8) | stream[position + 1];
		position+=2;
		if(next===0)
			break;
		if(next<FIRST_DATA_BLOCK || next>=totalBlocks || listedBlocks.indexOf(next)!==-1)
			return null;
		listedBlocks.push(next);
		stream.push.apply(stream, volume.subarray(next * blockSize + TAG_SIZE, (next + 1) * blockSize));
	}
	if(dataSize<1 || position + dataSize>stream.length)
		return null;

	var file=new BinaryReader(BUP_HEADER_SIZE + dataSize);
	file.writeString(BUP_MAGIC);
	file._u8array.set(volume.subarray(entryOffset + 0x04, entryOffset + 0x04 + NAME_SIZE), BUP_OFFSET_NAME);
	file._u8array.set(volume.subarray(entryOffset + 0x10, entryOffset + 0x10 + COMMENT_SIZE), BUP_OFFSET_COMMENT);
	file.writeU8At(BUP_OFFSET_LANGUAGE, volume[entryOffset + 0x0f]);
	file.writeU32At(BUP_OFFSET_DATE, readU32(entryOffset + 0x1a));
	file.writeU32At(BUP_OFFSET_HEADER_DATE, readU32(entryOffset + 0x1a));
	file.writeU32At(BUP_OFFSET_DATA_SIZE, dataSize);
	file.writeU16At(BUP_OFFSET_BLOCKS, listedBlocks.length);
	file._u8array.set(stream.slice(position, position + dataSize), BUP_HEADER_SIZE);

	return new Content(file._u8array.buffer);
}
Content.formatDate=function(minutes){
	//the console clock has no time zone, so the date is shown as it was stored
	var d=new Date(DATE_19800101 + minutes * 60000);
	return UI.formatDate(new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), d.getUTCHours(), d.getUTCMinutes()).getTime());
}

Content.prototype.setBlockSize=function(blockSize){
	this.blockSize=blockSize;
	this.size=blocksForData(blockSize, this.dataSize);
}
/* the 30 bytes that follow the tag in the save's first block */
Content.prototype.getEntry=function(){
	var entry=new Uint8Array(ENTRY_SIZE - TAG_SIZE);
	var raw=this._rawData._u8array;
	entry.set(raw.subarray(BUP_OFFSET_NAME, BUP_OFFSET_NAME + NAME_SIZE), 0x00);
	entry[0x0b]=raw[BUP_OFFSET_LANGUAGE];
	entry.set(raw.subarray(BUP_OFFSET_COMMENT, BUP_OFFSET_COMMENT + COMMENT_SIZE), 0x0c);
	entry.set(raw.subarray(BUP_OFFSET_DATE, BUP_OFFSET_DATE + 4), 0x16);
	entry.set(raw.subarray(BUP_OFFSET_DATA_SIZE, BUP_OFFSET_DATA_SIZE + 4), 0x1a);
	return entry;
}

Content.prototype.export=function(){
	this.buildRawData();

	return this._rawData.slice();
}
Content.prototype.buildRawData=function(){
	this._rawData.writeU16At(BUP_OFFSET_BLOCKS, this.size);

	this._rawData.name=(this.fileName || 'SAVE').replace(/[\\\/:*?"<>|]/g, '_')+'.bup';
	return this._rawData._u8array.buffer;
}
Content.prototype.info=function(){
	var summary=UI.getBlocksString(this.size);
	if(this.comment)
		summary=UI.monoText(UI.escapeHTML(this.comment)) + ' ' + summary;

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

	var name=fileName.replace(/[^A-Za-z0-9_\-.]/g, '_').substr(0, NAME_SIZE);
	this._rawData.writeStringAt(BUP_OFFSET_NAME, name, NAME_SIZE + 1);
	this.fileName=readText(this._rawData._u8array, BUP_OFFSET_NAME, NAME_SIZE);
}
Content.prototype.setComment=function(comment){
	if(typeof comment !== 'string')
		return false;

	var text=comment.replace(/[^\x20-\x7e]/g, '?').substr(0, COMMENT_SIZE);
	this._rawData.writeStringAt(BUP_OFFSET_COMMENT, text, COMMENT_SIZE + 1);
	this.comment=readText(this._rawData._u8array, BUP_OFFSET_COMMENT, COMMENT_SIZE);
}
Content.prototype.setLanguage=function(language){
	language=parseInt(language);
	if(!(language>=0 && language<LANGUAGES.length))
		return false;

	this.language=language;
	this._rawData.writeU8At(BUP_OFFSET_LANGUAGE, language);
}



/* helper functions */
function readText(u8array, offset, len){
	var str='';
	for(var i=0; i<len && u8array[offset + i]!==0x00; i++){
		var c=u8array[offset + i];
		str+=(c>=0x20 && c<0x7f)? String.fromCharCode(c) : '?';
	}
	return str.replace(/\s+$/, '');
}
function hasMagicAt(u8array, offset, step){
	for(var i=0; i<MAGIC.length; i++){
		if(u8array[offset + i * step]!==MAGIC[i])
			return false;
	}
	return true;
}
/* how many blocks a save of this many bytes takes, its entry and block list included */
function blocksForData(blockSize, dataSize){
	var blocks=1;
	while(blocks * (blockSize - TAG_SIZE) < ENTRY_SIZE - TAG_SIZE + blocks * 2 + dataSize)
		blocks++;
	return blocks;
}
