/*
* Dreamcast implementation for Memory Card Manager JS
*
* By Marc Robledo https://www.marcrobledo.com
* Sourcecode: https://github.com/marcrobledo/memory-card-manager-js/
* License:
*
* MIT License
* 
* Copyright (c) 2026 Marc Robledo
* 
* Permission is hereby granted, free of charge, to any person obtaining a copy
* of this software and associated documentation files (the "Software"), to deal
* in the Software without restriction, including without limitation the rights
* to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
* copies of the Software, and to permit persons to whom the Software is
* furnished to do so, subject to the following conditions:
* 
* The above copyright notice and this permission notice shall be included in all
* copies or substantial portions of the Software.
* 
* THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
* IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
* FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
* AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
* LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
* OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
* SOFTWARE.
*/

/*
	File format specification:
	http://mc.pp.se/dc/vms/flashmem.html
	http://mc.pp.se/dc/vms/fileheader.html
*/

const BLOCK_SIZE=0x0200;
const BLOCK_COUNT=256;
const RAW_SIZE=BLOCK_SIZE * BLOCK_COUNT;
const USER_BLOCKS=200;

const BLOCK_ROOT=255;
const BLOCK_FAT=254;
const BLOCK_DIRECTORY_FIRST=253; //253, 252, 251...
const BLOCK_DIRECTORY_COUNT=13;
const ROOT_MAGIC_SIZE=16;
const ROOT_MAGIC_BYTE=0x55;
const OFFSET_ROOT_CUSTOM_COLOR=0x10;
const OFFSET_ROOT_TIMESTAMP=0x30;
const OFFSET_ROOT_FAT_LOCATION=0x46;
const OFFSET_ROOT_FAT_SIZE=0x48;
const OFFSET_ROOT_DIRECTORY_LOCATION=0x4a;
const OFFSET_ROOT_DIRECTORY_SIZE=0x4c;
const OFFSET_ROOT_USER_BLOCKS=0x50;

const FAT_UNALLOCATED=0xfffc;
const FAT_END_OF_CHAIN=0xfffa;

const DIRECTORY_ENTRY_SIZE=0x20;
const DIRECTORY_ENTRIES_PER_BLOCK=BLOCK_SIZE / DIRECTORY_ENTRY_SIZE;
const DIRECTORY_ENTRY_FILE_TYPE=0x00;
const DIRECTORY_ENTRY_COPY_PROTECTION=0x01;
const DIRECTORY_ENTRY_FIRST_BLOCK=0x02;
const DIRECTORY_ENTRY_FILENAME=0x04;
const DIRECTORY_ENTRY_TIMESTAMP=0x10;
const DIRECTORY_ENTRY_FILESIZE=0x18; //in blocks
const DIRECTORY_ENTRY_HEADER_OFFSET=0x1a; //in blocks
const FILENAME_SIZE=12;

const FILE_TYPE_DATA=0x33;
const FILE_TYPE_GAME=0xcc;
const COPY_PROTECTED=0xff;

const HEADER_DESCRIPTION_SHORT=0x00;
const HEADER_DESCRIPTION_LONG=0x10;
const HEADER_ICON_COUNT=0x40;
const HEADER_ICON_SPEED=0x42;
const HEADER_EYECATCH_TYPE=0x44;
const HEADER_ICON_PALETTE=0x60;
const HEADER_ICON_BITMAPS=0x80;
const ICON_SIZE=32;
const ICON_BYTES=ICON_SIZE * ICON_SIZE / 2;
const MAX_ICONS=3;
const EYECATCH_WIDTH=72;
const EYECATCH_HEIGHT=56;
const EYECATCH_NONE=0;
const EYECATCH_ARGB4444=1;
const EYECATCH_PALETTE_256=2;
const EYECATCH_PALETTE_16=3;




const SYSTEM={
	id:'dc',
	slotLetters:true,
	validExtensions:'.bin,.dci',
	exampleFile:'example.bin',
	infoFields:[
		'comment1',
		'comment2',
		'eyecatch',
		'updateTimestamp',
		'fileTypeName'
	],
	editableFields:[
		'fileName',
		'copyProtected'
	]
}









function MemoryCard(arrayBuffer, name){
	this.unsavedChanges=false;
	this.size=USER_BLOCKS;
	this._rawData=new BinaryReader(arrayBuffer? arrayBuffer : RAW_SIZE, typeof name==='string'? name : 'memcard.bin');
	this._rawData.littleEndian=true;

	this.content=[];

	if(!arrayBuffer){
		var root=BLOCK_ROOT * BLOCK_SIZE;
		this._rawData.seek(root);
		this._rawData.fill(ROOT_MAGIC_SIZE, ROOT_MAGIC_BYTE);

		var now=new Date();
		this._rawData.writeBytesAt(root + OFFSET_ROOT_TIMESTAMP, [
			toBCD(Math.floor(now.getFullYear() / 100)),
			toBCD(now.getFullYear() % 100),
			toBCD(now.getMonth() + 1),
			toBCD(now.getDate()),
			toBCD(now.getHours()),
			toBCD(now.getMinutes()),
			toBCD(now.getSeconds()),
			now.getDay()
		]);
	}

	this.buildRawData();
}
MemoryCard.fromArrayBuffer=function(arrayBuffer, name){
	var rawFile=new BinaryReader(arrayBuffer);
	rawFile.littleEndian=true;

	if(rawFile.size!==RAW_SIZE)
		return null;
	for(var i=0; i<ROOT_MAGIC_SIZE; i++){
		if(rawFile.readU8At(BLOCK_ROOT * BLOCK_SIZE + i)!==ROOT_MAGIC_BYTE)
			return null;
	}

	var memoryCard=new MemoryCard(rawFile._u8array.buffer.slice(0), name);

	memoryCard.content=[];
	var maxEntries=BLOCK_DIRECTORY_COUNT * DIRECTORY_ENTRIES_PER_BLOCK;
	for(var i=0; i<maxEntries && memoryCard.content.length<USER_BLOCKS; i++){
		var entryOffset=
			(BLOCK_DIRECTORY_FIRST - Math.floor(i / DIRECTORY_ENTRIES_PER_BLOCK)) * BLOCK_SIZE +
			(i % DIRECTORY_ENTRIES_PER_BLOCK) * DIRECTORY_ENTRY_SIZE
		;

		var fileType=rawFile.readU8At(entryOffset + DIRECTORY_ENTRY_FILE_TYPE);
		if(fileType!==FILE_TYPE_DATA && fileType!==FILE_TYPE_GAME)
			continue;

		var size=rawFile.readU16At(entryOffset + DIRECTORY_ENTRY_FILESIZE);
		if(size<1 || size>USER_BLOCKS)
			continue;

		//follow the FAT chain
		var contentFile=new BinaryReader(DIRECTORY_ENTRY_SIZE + BLOCK_SIZE * size);
		rawFile.copyTo(contentFile, entryOffset, DIRECTORY_ENTRY_SIZE, 0x00);
		var block=rawFile.readU16At(entryOffset + DIRECTORY_ENTRY_FIRST_BLOCK);
		var valid=true;
		for(var j=0; j<size; j++){
			if(block>=USER_BLOCKS){
				valid=false;
				break;
			}
			rawFile.copyTo(contentFile, BLOCK_SIZE * block, BLOCK_SIZE, DIRECTORY_ENTRY_SIZE + BLOCK_SIZE * j);
			block=rawFile.readU16At(BLOCK_FAT * BLOCK_SIZE + block * 2);
		}

		if(valid){
			var newContent=new Content(contentFile._u8array.buffer);
			newContent._rawData.name=newContent.fileName+'.dci';
			memoryCard.content.push(newContent);
		}
	}
	return memoryCard;
}
MemoryCard.prototype.buildRawData=function(){
	var raw=this._rawData;

	//root block
	var root=BLOCK_ROOT * BLOCK_SIZE;
	raw.writeU16At(root + OFFSET_ROOT_FAT_LOCATION, BLOCK_FAT);
	raw.writeU16At(root + OFFSET_ROOT_FAT_SIZE, 1);
	raw.writeU16At(root + OFFSET_ROOT_DIRECTORY_LOCATION, BLOCK_DIRECTORY_FIRST);
	raw.writeU16At(root + OFFSET_ROOT_DIRECTORY_SIZE, BLOCK_DIRECTORY_COUNT);
	raw.writeU16At(root + OFFSET_ROOT_USER_BLOCKS, USER_BLOCKS);

	//FAT: system blocks are chained, the rest is free until files are allocated
	var fat=new Array(BLOCK_COUNT);
	for(var i=0; i<BLOCK_COUNT; i++)
		fat[i]=FAT_UNALLOCATED;
	fat[BLOCK_ROOT]=FAT_END_OF_CHAIN;
	fat[BLOCK_FAT]=FAT_END_OF_CHAIN;
	var lastDirectoryBlock=BLOCK_DIRECTORY_FIRST - BLOCK_DIRECTORY_COUNT + 1;
	for(var i=BLOCK_DIRECTORY_FIRST; i>lastDirectoryBlock; i--)
		fat[i]=i - 1;
	fat[lastDirectoryBlock]=FAT_END_OF_CHAIN;

	//user blocks: games first, as the VMU expects them at the start of the memory
	var layout=this.content.filter(function(c){return c.fileType===FILE_TYPE_GAME})
		.concat(this.content.filter(function(c){return c.fileType!==FILE_TYPE_GAME}));
	var nextBlock=0;
	for(var i=0; i<layout.length; i++){
		layout[i].firstDataBlock=nextBlock;
		layout[i].buildRawData();

		for(var j=0; j<layout[i].size; j++){
			layout[i]._rawData.copyTo(raw, DIRECTORY_ENTRY_SIZE + BLOCK_SIZE * j, BLOCK_SIZE, BLOCK_SIZE * nextBlock);
			fat[nextBlock]=(j===layout[i].size - 1)? FAT_END_OF_CHAIN : nextBlock + 1;
			nextBlock++;
		}
	}
	raw.seek(BLOCK_SIZE * nextBlock);
	raw.fill(BLOCK_SIZE * (USER_BLOCKS - nextBlock), 0x00);

	for(var i=0; i<BLOCK_COUNT; i++)
		raw.writeU16At(BLOCK_FAT * BLOCK_SIZE + i * 2, fat[i]);

	//directory
	raw.seek(lastDirectoryBlock * BLOCK_SIZE);
	raw.fill(BLOCK_SIZE * BLOCK_DIRECTORY_COUNT, 0x00);
	for(var i=0; i<this.content.length; i++){
		this.content[i].buildRawData(); //firstDataBlock is already set above
		var entryOffset=
			(BLOCK_DIRECTORY_FIRST - Math.floor(i / DIRECTORY_ENTRIES_PER_BLOCK)) * BLOCK_SIZE +
			(i % DIRECTORY_ENTRIES_PER_BLOCK) * DIRECTORY_ENTRY_SIZE
		;
		this.content[i]._rawData.copyTo(raw, 0x00, DIRECTORY_ENTRY_SIZE, entryOffset);
	}

	return raw._u8array.buffer;
}
MemoryCard.prototype.getFreeBlocks=function(){
	var freeBlocks=this.size;
	for(var i=0; i<this.content.length; i++){
		freeBlocks-=this.content[i].size;
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
	if(content.size <= this.getFreeBlocks() && this.content.length<USER_BLOCKS){
		this.content.push(content);
		return true;
	}
	return false;
}

MemoryCard.prototype.format=function(block){
	if(this.content.length)
		this.unsavedChanges=true;
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
	Content._rawData is a 32-byte directory entry followed by the file blocks, as they are stored in the VMU.
	Exported .dci files are the same, but with the file data byte-swapped in 32-bit words.
*/
function Content(arrayBuffer){
	this._rawData=new BinaryReader(arrayBuffer);
	this._rawData.littleEndian=true;


	/* parse data */
	this.fileType=this._rawData.readU8At(DIRECTORY_ENTRY_FILE_TYPE);
	this.fileTypeName=(this.fileType===FILE_TYPE_GAME)? 'Mini-game' : 'Save data';
	this.copyProtected=this._rawData.readU8At(DIRECTORY_ENTRY_COPY_PROTECTION)===COPY_PROTECTED;
	this.firstDataBlock=this._rawData.readU16At(DIRECTORY_ENTRY_FIRST_BLOCK);
	this.fileName=this._rawData.readStringAt(DIRECTORY_ENTRY_FILENAME, FILENAME_SIZE).replace(/[^\x20-\x7e]/g, '').trim();
	this.size=this._rawData.readU16At(DIRECTORY_ENTRY_FILESIZE);
	this.headerOffset=this._rawData.readU16At(DIRECTORY_ENTRY_HEADER_OFFSET);

	var timestamp=this._rawData.readBytesAt(DIRECTORY_ENTRY_TIMESTAMP, 8).map(fromBCD);
	if(timestamp[2]>=1 && timestamp[2]<=12 && timestamp[3]>=1 && timestamp[3]<=31)
		this.updateTimestamp=UI.formatDate(new Date(timestamp[0] * 100 + timestamp[1], timestamp[2] - 1, timestamp[3], timestamp[4], timestamp[5]).getTime());
	else
		this.updateTimestamp='';

	/* parse file header */
	var headerOffset=DIRECTORY_ENTRY_SIZE + this.headerOffset * BLOCK_SIZE;
	this.comment1='';
	this.comment2='';
	if(headerOffset + HEADER_ICON_BITMAPS <= this._rawData.size){
		this.comment1=UI.escapeHTML(Content.readText(this._rawData, headerOffset + HEADER_DESCRIPTION_SHORT, 16));
		this.comment2=UI.escapeHTML(Content.readText(this._rawData, headerOffset + HEADER_DESCRIPTION_LONG, 32));
		this.readIcon(headerOffset);
	}
}
Content.fromArrayBuffer=function(arrayBuffer){
	var file=new BinaryReader(arrayBuffer);
	file.littleEndian=true;

	if(file.size<DIRECTORY_ENTRY_SIZE + BLOCK_SIZE || (file.size - DIRECTORY_ENTRY_SIZE) % BLOCK_SIZE !== 0)
		return null;

	var fileType=file.readU8At(DIRECTORY_ENTRY_FILE_TYPE);
	var size=file.readU16At(DIRECTORY_ENTRY_FILESIZE);
	if(
		(fileType===FILE_TYPE_DATA || fileType===FILE_TYPE_GAME) &&
		size>=1 && size<=USER_BLOCKS && size * BLOCK_SIZE === file.size - DIRECTORY_ENTRY_SIZE
	){
		var copy=arrayBuffer.slice(0);
		Content.swapWords(new Uint8Array(copy));
		return new Content(copy);
	}

	return null;
}
Content.swapWords=function(u8array){
	for(var i=DIRECTORY_ENTRY_SIZE; i + 3<u8array.length; i+=4){
		var tmp=u8array[i];
		u8array[i]=u8array[i + 3];
		u8array[i + 3]=tmp;
		tmp=u8array[i + 1];
		u8array[i + 1]=u8array[i + 2];
		u8array[i + 2]=tmp;
	}
}
Content.readText=function(rawData, offset, len){
	var str='';
	for(var i=0; i<len; i++){
		var b=rawData.readU8At(offset + i);
		if(b===0x00)
			break;

		if(b>=0x20 && b<0x7f){
			str+=String.fromCharCode(b);
		}else if(b>=0xa1 && b<=0xdf){ //half-width katakana
			str+=String.fromCharCode(0xff61 + b - 0xa1);
		}else if(((b>=0x81 && b<=0x9f) || (b>=0xe0 && b<=0xfc)) && i + 1<len){
			str+=shiftJIStoUnicode((b << 8) | rawData.readU8At(offset + i + 1));
			i++;
		}
	}
	return str.replace(/\0/g, '').trim();
}
Content.convertColor=function(argb4444){
	return [
		((argb4444 >>> 8) & 0x0f) * 17,
		((argb4444 >>> 4) & 0x0f) * 17,
		(argb4444 & 0x0f) * 17,
		255
	];
}
Content.paletteToImageData=function(width, height, getPaletteIndex, palette){
	var imageData=new ImageData(width, height);
	for(var i=0; i<width * height; i++){
		var color=palette[getPaletteIndex(i)];
		imageData.data[i * 4 + 0]=color[0];
		imageData.data[i * 4 + 1]=color[1];
		imageData.data[i * 4 + 2]=color[2];
		imageData.data[i * 4 + 3]=color[3];
	}
	return imageData;
}

Content.prototype.export=function(){
	this.buildRawData();

	var file=this._rawData.slice();
	Content.swapWords(file._u8array);
	return file;
}
Content.prototype.buildRawData=function(){
	this._rawData.writeU16At(DIRECTORY_ENTRY_FIRST_BLOCK, this.firstDataBlock);

	this._rawData.name=(this.fileName || 'dreamcast').replace(/[\\\/:*?"<>|]/g, '_')+'.dci';
	return this._rawData._u8array.buffer;
}
Content.prototype.info=function(){
	var summary=UI.monoText(UI.escapeHTML(this.fileName)) + ' ' + UI.getBlocksString(this.size);

	return {
		region:REGION_UNKNOWN,
		blocks:this.size,
		name:this.comment2 || this.comment1 || UI.escapeHTML(this.fileName),
		summary:summary
	};
}

Content.prototype.setFileName=function(fileName){
	if(typeof fileName !== 'string')
		return false;

	this.fileName=fileName.replace(/[^\x20-\x7e]/g, '').substr(0, FILENAME_SIZE).trim();
	this._rawData.writeStringAt(DIRECTORY_ENTRY_FILENAME, this.fileName, FILENAME_SIZE);
}
Content.prototype.setCopyProtected=function(copyProtected){
	this.copyProtected=!!copyProtected;
	this._rawData.writeU8At(DIRECTORY_ENTRY_COPY_PROTECTION, this.copyProtected? COPY_PROTECTED : 0x00);
}

Content.prototype.readIcon=function(headerOffset){
	var iconCount=this._rawData.readU16At(headerOffset + HEADER_ICON_COUNT);
	var iconSpeed=this._rawData.readU16At(headerOffset + HEADER_ICON_SPEED);
	var eyecatchType=this._rawData.readU16At(headerOffset + HEADER_EYECATCH_TYPE);

	var iconsOffset=headerOffset + HEADER_ICON_BITMAPS;
	var eyecatchOffset=iconsOffset + iconCount * ICON_BYTES;
	if(iconCount<1 || iconCount>MAX_ICONS || eyecatchOffset>this._rawData.size)
		return false;

	var palette=[];
	for(var i=0; i<16; i++)
		palette.push(Content.convertColor(this._rawData.readU16At(headerOffset + HEADER_ICON_PALETTE + i * 2)));

	var iconImageDatas=[];
	for(var i=0; i<iconCount; i++){
		var bitmapOffset=iconsOffset + i * ICON_BYTES;
		iconImageDatas.push(Content.paletteToImageData(ICON_SIZE, ICON_SIZE, (function(offset, rawData){
			return function(p){
				var b=rawData.readU8At(offset + (p >> 1));
				return (p & 1)? (b & 0x0f) : (b >> 4);
			}
		}(bitmapOffset, this._rawData)), palette));
	}
	this.icon=new ContentIcon(iconImageDatas);
	if(iconSpeed)
		this.icon.speed=Math.min(iconSpeed, 120) * 2; //speed is in 1/30s, animation loop runs at 60fps

	var rawData=this._rawData;
	var pixels=EYECATCH_WIDTH * EYECATCH_HEIGHT;
	if(eyecatchType===EYECATCH_ARGB4444 && eyecatchOffset + pixels * 2 <= rawData.size){
		this.eyecatch=new ImageData(EYECATCH_WIDTH, EYECATCH_HEIGHT);
		for(var i=0; i<pixels; i++){
			var color=Content.convertColor(rawData.readU16At(eyecatchOffset + i * 2));
			this.eyecatch.data.set(color, i * 4);
		}
	}else if(eyecatchType===EYECATCH_PALETTE_256 && eyecatchOffset + 512 + pixels <= rawData.size){
		var palette256=[];
		for(var i=0; i<256; i++)
			palette256.push(Content.convertColor(rawData.readU16At(eyecatchOffset + i * 2)));
		this.eyecatch=Content.paletteToImageData(EYECATCH_WIDTH, EYECATCH_HEIGHT, function(p){
			return rawData.readU8At(eyecatchOffset + 512 + p);
		}, palette256);
	}else if(eyecatchType===EYECATCH_PALETTE_16 && eyecatchOffset + 32 + pixels / 2 <= rawData.size){
		var palette16=[];
		for(var i=0; i<16; i++)
			palette16.push(Content.convertColor(rawData.readU16At(eyecatchOffset + i * 2)));
		this.eyecatch=Content.paletteToImageData(EYECATCH_WIDTH, EYECATCH_HEIGHT, function(p){
			var b=rawData.readU8At(eyecatchOffset + 32 + (p >> 1));
			return (p & 1)? (b & 0x0f) : (b >> 4);
		}, palette16);
	}

	return true;
}




/* helper functions */
function toBCD(n){
	return ((Math.floor(n / 10) % 10) << 4) | (n % 10);
}
function fromBCD(b){
	return ((b >> 4) * 10) + (b & 0x0f);
}
