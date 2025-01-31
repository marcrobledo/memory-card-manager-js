/*
* Gamecube implementation for Memory Card Manager JS
*
* By Marc Robledo https://www.marcrobledo.com
* Sourcecode: https://github.com/marcrobledo/memory-card-manager-js/
* License:
*
* MIT License
* 
* Copyright (c) 2023-2025 Marc Robledo
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
	http://hitmen.c02.at/files/yagcd/yagcd/chap12.html
	https://wiki.tockdom.com/wiki/Image_Formats#RGB5A3
	https://github.com/dolphin-emu/dolphin/blob/master/Source/Core/Core/HW/GCMemcard/GCMemcard.cpp
*/

const RAW_BLOCK_SIZE=0x2000;
const RAW_SIZES=[RAW_BLOCK_SIZE * (59+5), RAW_BLOCK_SIZE * (251+5), RAW_BLOCK_SIZE * (1019+5)];

const DATE_20000101=946681200000;
const OFFSET_BLOCK_HEADER=0x0000;
const OFFSET_HEADER_SERIAL=OFFSET_BLOCK_HEADER + 0x0000;
const OFFSET_HEADER_FORMAT_TIMESTAMP=OFFSET_BLOCK_HEADER + 0x000c;
const OFFSET_HEADER_SRAM_BIAS=OFFSET_BLOCK_HEADER + 0x0014;
const OFFSET_HEADER_SRAM_LANGUAGE=OFFSET_BLOCK_HEADER + 0x0018;
const OFFSET_HEADER_SIZE_MBITS=OFFSET_BLOCK_HEADER + 0x0022;
const OFFSET_HEADER_ENCODING=OFFSET_BLOCK_HEADER + 0x0024;
const OFFSET_HEADER_CHECKSUM1=OFFSET_BLOCK_HEADER + 0x01fc;
const OFFSET_HEADER_CHECKSUM2=OFFSET_BLOCK_HEADER + 0x01fe;
const HEADER_SIZE_59=(59+5) / 16;
const HEADER_SIZE_251=(251+5) / 16;
const HEADER_SIZE_1019=(1019+5) / 16;
const VALID_HEADER_SIZES=[HEADER_SIZE_59, HEADER_SIZE_251, HEADER_SIZE_1019];

const OFFSET_BLOCK_DIRECTORY=0x2000;
const OFFSET_BLOCK_DIRECTORY_BACKUP=0x4000;
const OFFSET_DIRECTORY_DIRECTORY_ENTRIES=OFFSET_BLOCK_DIRECTORY + 0x0000; //max 127
const OFFSET_DIRECTORY_UPDATE_COUNTER=OFFSET_BLOCK_DIRECTORY + 0x0ffa;
const OFFSET_DIRECTORY_CHECKSUM1=OFFSET_BLOCK_DIRECTORY + 0x0ffc;
const OFFSET_DIRECTORY_CHECKSUM2=OFFSET_BLOCK_DIRECTORY + 0x0ffe;
const DIRECTORY_SIZE=0x40;

const DIRECTORY_ENTRY_GAMECODE=0x0000;
const DIRECTORY_ENTRY_MAKERCODE=0x0004;
const DIRECTORY_ENTRY_BANNER_FORMAT_ICON_ANIMATION=0x0007;
const DIRECTORY_ENTRY_FILENAME=0x0008;
const DIRECTORY_ENTRY_UPDATE_TIMESTAMP=0x0028;
const DIRECTORY_ENTRY_IMAGE_DATA_OFFSET=0x002c;
const DIRECTORY_ENTRY_ICON_FORMAT=0x0030;
const DIRECTORY_ENTRY_ICON_ANIMATION_SPEED=0x0032;
const DIRECTORY_ENTRY_FILE_PERMISSIONS=0x0034;
const DIRECTORY_ENTRY_COPY_COUNTER=0x0035;
const DIRECTORY_ENTRY_FIRST_DATABLOCK=0x0036;
const DIRECTORY_ENTRY_FILESIZE=0x0038; //in blocks
const DIRECTORY_ENTRY_COMMENT_OFFSET=0x003c;

const ICON_FORMAT_NO_ICON=0x00;
const ICON_FORMAT_CI8_UNIQUE_PALETTE=0x01;
const ICON_FORMAT_RGBA5A3=0x02;
const ICON_FORMAT_CI8=0x03;
const MAX_ICONS=8;

const OFFSET_BLOCK_BLOCK_ALLOCATION_MAP=0x6000;
const OFFSET_BLOCK_ALLOCATION_MAP_UPDATE_COUNTER=OFFSET_BLOCK_BLOCK_ALLOCATION_MAP + 0x0004;
const OFFSET_BLOCK_ALLOCATION_MAP_FREE_BLOCKS=OFFSET_BLOCK_BLOCK_ALLOCATION_MAP + 0x0006;
const OFFSET_BLOCK_ALLOCATION_MAP_LAST_ALLOCATED_BLOCK=OFFSET_BLOCK_BLOCK_ALLOCATION_MAP + 0x0008;
const OFFSET_BLOCK_ALLOCATION_MAP_MAP=OFFSET_BLOCK_BLOCK_ALLOCATION_MAP + 0x000a;
const OFFSET_BLOCK_BLOCK_ALLOCATION_MAP_BACKUP=0x8000;

const OFFSET_BLOCK_FILE_DATA=0xa000;





const GC_REGION_JPN='J';
const GC_REGION_USA='E';
const GC_REGION_EUR='P';

/* service worker */
const FORCE_HTTPS=true;
if(FORCE_HTTPS && location.protocol==='http:')
	location.href=window.location.href.replace('http:','https:');
/*else if(location.protocol==='https:' && 'serviceWorker' in navigator)
	navigator.serviceWorker.register('/memcard_manager/psx/_cache_service_worker.js', {scope: '/memcard_manager/psx/'});*/




const SYSTEM={
	id:'gc',
	slotLetters:true,
	validExtensions:'.raw,.gci',
	exampleFile:'example.raw',
	infoFields:[
		'comment1',
		'comment2',
		'banner',
		'updateTimestamp',
		'copyCounter'
	],
	editableFields:[
		'fileName',
		'gameCode',
		'makerCode',
		'filePermissionsPublic',
		'filePermissionsNoCopy',
		'filePermissionsNoMove',
	]
}


/* initialize app */
$(document).ready(function(){
	$('#modal-warning .btn-cancel').on('click', function(evt){
		document.getElementById('modal-warning').close();
	});
	$('#modal-warning').get(0).showModal();
});




function MemoryCard(arrayBuffer, name){
	this.unsavedChanges=false;
	this._rawData=new BinaryReader(arrayBuffer? arrayBuffer : RAW_BLOCK_SIZE * 5, typeof name==='string'? name : 'memcard.raw');

	this.content=[];

	if(arrayBuffer){
		var sizeMbits=this._rawData.readU16At(OFFSET_HEADER_SIZE_MBITS);
		if(sizeMbits===HEADER_SIZE_59)
			this.size=59;
		else if(sizeMbits===HEADER_SIZE_251)
			this.size=251;
		else if(sizeMbits===HEADER_SIZE_1019)
			this.size=1019;
		else
			return null;
		
		this.serial=this._rawData.readBytesAt(OFFSET_HEADER_SERIAL, 12);
		this.encodingShiftJIS=!!this._rawData.readU16At(OFFSET_HEADER_ENCODING);
	}else{
		this.size=59;

		this.serial=new Array(0x0c);
		for(var i=0; i<this.serial.length; i++){
			this.serial[i]=Math.floor(Math.random() * 256); //serial
		}
		this.encodingShiftJIS=false;

		//unused data
		this._rawData.seek(0x26);
		this._rawData.fill(0x01d6, 0xff);
		this._rawData.seek(0x0200);
		this._rawData.fill(0x1e00, 0xff);
	}

	this.buildRawData();
}
MemoryCard.fromArrayBuffer=function(arrayBuffer, name){
	var rawFile=new BinaryReader(arrayBuffer);

	if(RAW_SIZES.indexOf(rawFile.size)!==-1){
		var memoryCard=new MemoryCard(rawFile.slice(0, OFFSET_BLOCK_FILE_DATA)._u8array.buffer, name);

		memoryCard.content=[];
		for(var i=0; i<128; i++){
			//extract GCI
			var directoryOffset=OFFSET_DIRECTORY_DIRECTORY_ENTRIES + i * DIRECTORY_SIZE;

			var size=rawFile.readU16At(directoryOffset + DIRECTORY_ENTRY_FILESIZE);
			if(size && size>=1 && size<=memoryCard.size){
				var startingBlock=rawFile.readU16At(directoryOffset + DIRECTORY_ENTRY_FIRST_DATABLOCK);
				var gciFile=new BinaryReader(DIRECTORY_SIZE + RAW_BLOCK_SIZE*size);
				rawFile.copyTo(gciFile, directoryOffset, DIRECTORY_SIZE, 0x00);
				rawFile.copyTo(gciFile, RAW_BLOCK_SIZE * startingBlock, RAW_BLOCK_SIZE * size, DIRECTORY_SIZE);

				var newContent=Content.fromArrayBuffer(gciFile._u8array);
				if(newContent){
					newContent._rawData.name=newContent.fileName+'.gci';
					memoryCard.content.push(newContent);
				}
			}
		}
		return memoryCard;
	}
	return null;
}
MemoryCard.prototype.buildRawData=function(){
	//header block
	this._rawData.seek(OFFSET_HEADER_SERIAL);
	this._rawData.writeBytes(this.serial);
	this._rawData.seek(OFFSET_HEADER_SIZE_MBITS);
	this._rawData.writeU16((this.size+5) / 16);
	this._rawData.seek(0x0000);
	this._rawData.calculateGcXor(0x01fc);



	//directory block
	var nextBlock=5;
	for(var i=0; i<this.content.length; i++){
		this.content[i].firstDataBlock=nextBlock;
		this.content[i].buildRawData();
		
		this.content[i]._rawData.copyTo(this._rawData, 0x00, DIRECTORY_SIZE, OFFSET_BLOCK_DIRECTORY + DIRECTORY_SIZE * i);

		nextBlock+=this.content[i].size;
	}
	for(; i<127; i++){
		this._rawData.seek(OFFSET_BLOCK_DIRECTORY + DIRECTORY_SIZE * i);
		this._rawData.fill(DIRECTORY_SIZE, 0xff);
	}
	for(; i<128; i++){
		this._rawData.seek(OFFSET_BLOCK_DIRECTORY + DIRECTORY_SIZE * i);
		this._rawData.fill(DIRECTORY_SIZE - 6, 0xff);
	}
	this._rawData.seek(OFFSET_BLOCK_DIRECTORY);
	this._rawData.calculateGcXor(RAW_BLOCK_SIZE - 4);
	//backup directory block
	this._rawData.copyTo(this._rawData, OFFSET_BLOCK_DIRECTORY, RAW_BLOCK_SIZE, OFFSET_BLOCK_DIRECTORY_BACKUP);

	//allocation map block
	nextBlock=5;
	this._rawData.seek(OFFSET_BLOCK_ALLOCATION_MAP_MAP);
	for(var i=0; i<this.content.length; i++){
		
		for(var j=0; j<this.content[i].size - 1; j++){
			this._rawData.writeU16(nextBlock + 1);
			nextBlock++;
		}
		this._rawData.writeU16(0xffff);
		nextBlock++;
	}
	this._rawData.writeU16At(OFFSET_BLOCK_ALLOCATION_MAP_FREE_BLOCKS, this.getFreeBlocks());
	this._rawData.writeU16At(OFFSET_BLOCK_ALLOCATION_MAP_LAST_ALLOCATED_BLOCK, nextBlock - 1);
	for(; nextBlock<4096; nextBlock++){
		this._rawData.writeU16(0x0000);
	}
	this._rawData.seek(OFFSET_BLOCK_BLOCK_ALLOCATION_MAP + 4);
	this._rawData.calculateGcXor(RAW_BLOCK_SIZE - 4, OFFSET_BLOCK_BLOCK_ALLOCATION_MAP);
	//backup block allocation map
	this._rawData.copyTo(this._rawData, OFFSET_BLOCK_BLOCK_ALLOCATION_MAP, RAW_BLOCK_SIZE, OFFSET_BLOCK_BLOCK_ALLOCATION_MAP_BACKUP);

	return this._rawData._u8array.buffer;
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
		summary: UI.getFreeBlocksString(freeBlocks) + (this.encodingShiftJIS? ' '+UI.getFlagIcon(REGION_JPN): '')
	}
}

MemoryCard.prototype.export=function(){
	this.buildRawData();

	var rawFile=new BinaryReader((this.size + 5) * RAW_BLOCK_SIZE);
	this._rawData.copyTo(rawFile, 0x00, RAW_BLOCK_SIZE * 5, 0x00);


	var nextBlock=5;
	for(var i=0; i<this.content.length; i++){
		if(this.content[i].fileName==='f_zero.dat' && this.content[i].size===4){
			var encodedSerial=this.getEncodedSerial();
			this.content[i]._rawData.writeU8At(0x0060, encodedSerial[0] & 0xffff);
			this.content[i]._rawData.writeU8At(0x0066, encodedSerial[0] >>> 16);
			this.content[i]._rawData.writeU8At(0x0200, encodedSerial[1] & 0xffff);
			this.content[i]._rawData.writeU8At(0x1580, encodedSerial[1] >>> 16);

			var checksum=0xffff;
			for (var j=0x02; j<0x8000; j++){
				checksum=(checksum ^ (j & 0xff)) >>> 0;
				for(var k=8; k>0; k--){
					if(checksum & 1)
						checksum=(checksum >> 1) ^ 0x8408;
					else
						checksum=checksum >>> 1;
				}
			}
			this.content[i]._rawData.writeU16At(0x0000, (~checksum) & 0xffff);
		}

		this.content[i]._rawData.copyTo(rawFile, DIRECTORY_SIZE, RAW_BLOCK_SIZE * this.content[i].size, RAW_BLOCK_SIZE * nextBlock);
		nextBlock+=this.content[i].size;
	}
	for(;nextBlock<this.size+5; nextBlock++){
		rawFile.seek(RAW_BLOCK_SIZE * nextBlock);
		rawFile.fill(RAW_BLOCK_SIZE, 0xff);
	}

	rawFile.name=this._rawData.name;
	return rawFile;
}

MemoryCard.prototype.importContent=function(content){
	var freeBlocks=this.getFreeBlocks();

	if(content.size <= freeBlocks && this.content.length<127){
		this.content.push(content);
		return true;
	}else if(this.size===59){
		this.size=251;
		return this.importContent(content);
	}else if(this.size===251){
		this.size=2019;
		return this.importContent(content);
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

MemoryCard.prototype.getEncodedSerial=function(){
	return [
		(this.serial[0]^this.serial[2]^this.serial[4]^this.serial[6]) >>> 0,
		(this.serial[1]^this.serial[3]^this.serial[5]^this.serial[7]) >>> 0
	];
}






















function Content(arrayBuffer){
	this._rawData=new BinaryReader(arrayBuffer);


	/* parse data */
	this._rawData.seek(0x00);
	this.gameCode=this._rawData.readStringAt(DIRECTORY_ENTRY_GAMECODE, 4);
	this.makerCode=this._rawData.readStringAt(DIRECTORY_ENTRY_MAKERCODE, 2);
	this.fileName=this._rawData.readStringAt(DIRECTORY_ENTRY_FILENAME, 0x20);
	this.updateTimestamp=this._rawData.readU32At(DIRECTORY_ENTRY_UPDATE_TIMESTAMP);
	this.filePermissions=this._rawData.readU8At(DIRECTORY_ENTRY_FILE_PERMISSIONS);
	this.copyCounter=this._rawData.readU8At(DIRECTORY_ENTRY_COPY_COUNTER);
	this.firstDataBlock=this._rawData.readU16At(DIRECTORY_ENTRY_FIRST_DATABLOCK);
	this.size=this._rawData.readU16At(DIRECTORY_ENTRY_FILESIZE);
	this.commentOffset=this._rawData.readU32At(DIRECTORY_ENTRY_COMMENT_OFFSET);

	this.updateTimestamp=UI.formatDate(DATE_20000101 + this.updateTimestamp * 1000);



	this.filePermissionsPublic=this.filePermissions & 0x04;
	this.filePermissionsNoCopy=this.filePermissions & 0x08;
	this.filePermissionsNoMove=this.filePermissions & 0x10;

	this.comment1=this._rawData.readStringAt(DIRECTORY_SIZE + this.commentOffset, 32);
	this.comment2=this._rawData.readStringAt(DIRECTORY_SIZE + this.commentOffset + 32, 32);

	/*this.gameName='';
	for(var i=0; i<0x20; i++){
		this.gameName+=shiftJIStoUnicode(this._rawData.readU16());
	}
	this.gameName=this.gameName.replace(/\0/g, '');	
	if(!this.gameName){
		this._rawData.seek(0x80 + 0x04); //get ASCII game name if Shift-JIS conversion failed
		this.gameName=this._rawData.readString(0x20);
		this.gameNameShiftJIS=false;
	}else{
		this.gameNameShiftJIS=true;
	}*/

	/* parse icon */
	var bannerFormatIconAnimation=this._rawData.readU8At(DIRECTORY_ENTRY_BANNER_FORMAT_ICON_ANIMATION);

	this.hasBanner=bannerFormatIconAnimation & 0x03;
	this.bannerFormatCI8=bannerFormatIconAnimation & 0x01;
	this.iconFormat=this._rawData.readU16At(DIRECTORY_ENTRY_ICON_FORMAT);
	this.iconAnimationBackForth=bannerFormatIconAnimation & 0x04;
	this.iconAnimationSpeed=this._rawData.readU16At(DIRECTORY_ENTRY_ICON_ANIMATION_SPEED);
	this.imageDataOffset=this._rawData.readU32At(DIRECTORY_ENTRY_IMAGE_DATA_OFFSET);

	this.readIcon();
	
}
Content.fromArrayBuffer=function(arrayBuffer){
	var file=new BinaryReader(arrayBuffer);
	if((file.size >= (RAW_BLOCK_SIZE*59+DIRECTORY_SIZE)) || (((file.size - DIRECTORY_SIZE) % RAW_BLOCK_SIZE) !== 0))
		return null;

	var size=file.readU16At(DIRECTORY_ENTRY_FILESIZE);
	if(size && size>=1 && size<=59)
		return new Content(arrayBuffer);

	return null;
}

Content.prototype.export=function(){
	this.buildRawData();

	return this._rawData.slice();
}
Content.prototype.buildRawData=function(){
	this._rawData.seek(0x00);
	this._rawData.writeU16At(DIRECTORY_ENTRY_FIRST_DATABLOCK, this.firstDataBlock);
	//this._rawData.calculatePsxXor(0x7f);

	var fileName=this.fileName;
	if(this.identifier)
		fileName+='_'+this.identifier;
	this._rawData.name=fileName+'.gci';
	return this._rawData._u8array.buffer;
}
Content.prototype.info=function(){
	var region;
	if(this.gameCode.charAt(3)===GC_REGION_JPN)
		region=REGION_JPN;
	else if(this.gameCode.charAt(3)===GC_REGION_USA)
		region=REGION_USA;
	else if(this.gameCode.charAt(3)===GC_REGION_EUR)
		region=REGION_EUR;
	else
		region=REGION_UNKNOWN;

	var summary=UI.monoText(this.gameCode + this.makerCode) + ' ' + UI.getFlagIcon(region) + ' ';
	summary+=UI.getBlocksString(this.size);

	return {
		region:region,
		gameCode:this.gameCode,
		makerCode:this.makerCode,
		blocks:this.size,
		name:this.comment1.replace(/</g,'&lt;').replace(/>/g,'&gt;'),
		summary:summary
	};
}

Content.prototype.setFileName=function(fileName){
	if(typeof fileName !== 'string')
		return false;

	this.fileName=fileName;
	this._rawData.writeStringAt(DIRECTORY_ENTRY_FILENAME, this.fileName, 0x20);
}
Content.prototype.setGameCode=function(gameCode){
	if(typeof gameCode !== 'string')
		return false;

	this.gameCode=gameCode.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
	this._rawData.writeStringAt(DIRECTORY_ENTRY_GAMECODE, this.gameCode, 0x04);
}
Content.prototype.setMakerCode=function(makerCode){
	if(typeof makerCode !== 'string')
		return false;

	this.makerCode=makerCode.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
	this._rawData.writeStringAt(DIRECTORY_ENTRY_MAKERCODE, this.makerCode, 0x02);
}
Content.prototype.setFilePermissionsPublic=function(filePermissionsPublic){
	this.setFilePermissions(
		!!filePermissionsPublic,
		this.filePermissionsNoCopy,
		this.filePermissionsNoMove
	);
}
Content.prototype.setFilePermissionsNoCopy=function(filePermissionsNoCopy){
	this.setFilePermissions(
		this.filePermissionsPublic,
		!!filePermissionsNoCopy,
		this.filePermissionsNoMove
	);
}
Content.prototype.setFilePermissionsNoMove=function(filePermissionsNoMove){
	this.setFilePermissions(
		this.filePermissionsPublic,
		this.filePermissionsNoCopy,
		!!filePermissionsNoMove
	);
}
Content.prototype.setFilePermissions=function(isPublic, noCopy, noMove){
	this.filePermissionsPublic=isPublic;
	this.filePermissionsNoCopy=noCopy;
	this.filePermissionsNoMove=noMove;

	this.filePermissions&=~0x1c;
	this.filePermissions|=
		((this.filePermissionsPublic? 1:0) << 2) +
		((this.filePermissionsNoCopy? 1:0) << 3) +
		((this.filePermissionsNoMove? 1:0) << 4)
	;

	this._rawData.writeU8At(DIRECTORY_ENTRY_FILE_PERMISSIONS, this.filePermissions);
}

Content.convertColor=function(rgba5a3){
	var rgb15=rgba5a3 & 0x8000;
	if(rgb15){
		return[
			Math.round(((rgba5a3 >>> 10) & 0x1f) * 8.22580645161291),
			Math.round(((rgba5a3 >>> 5) & 0x1f) * 8.22580645161291),
			Math.round(((rgba5a3 >>> 0) & 0x1f) * 8.22580645161291),
			255
		]
	}else{
		return[
			((rgba5a3 >>> 8) & 0x0f) * 17,
			((rgba5a3 >>> 4) & 0x0f) * 17,
			((rgba5a3 >>> 0) & 0x0f) * 17,
			Math.round(((rgba5a3 >>> 12) & 0x07) * 36.428571429),
		]
	}
}
Content.imageDataToRGB24=function(width, height, CI8, rawData, predefinedPalette){
	var pixelData;
	var blockWidth;
	var blockHeight=4;
	if(CI8){ //CI8
		blockWidth=8;
		pixelData=rawData.readBytes(width * height);

		var palette;
		if(predefinedPalette){
			palette=predefinedPalette;
		}else{
			palette=[];
			for(var i=0; i<0x0100; i++)
				palette.push(Content.convertColor(rawData.readU16()));
		}
		for(var i=0; i<pixelData.length; i++)
			pixelData[i]=palette[pixelData[i]];
	}else{
		blockWidth=4;
		pixelData=[];
		for(var i=0; i<width*height; i++)
			pixelData.push(Content.convertColor(rawData.readU16()));
	}

	var canvas=document.createElement('canvas');
	canvas.width=width;
	canvas.height=height;

	var ctx=canvas.getContext('2d');
	ctx.fillStyle='black'
	ctx.fillRect(0, 0, canvas.width, canvas.height);	
	
	var bannerImageData=ctx.createImageData(width, height);
	var offset=0;
	for(var i=0; i<height / blockHeight; i++){
		for(var j=0; j<width / blockWidth; j++){
			for(var y=0; y<blockHeight; y++){
				for(var x=0; x<blockWidth; x++){
					bannerImageData.data[(x + (j * blockWidth) + ((y + (i * blockHeight)) * width)) * 4 + 0]=pixelData[offset][0];
					bannerImageData.data[(x + (j * blockWidth) + ((y + (i * blockHeight)) * width)) * 4 + 1]=pixelData[offset][1];
					bannerImageData.data[(x + (j * blockWidth) + ((y + (i * blockHeight)) * width)) * 4 + 2]=pixelData[offset][2];
					bannerImageData.data[(x + (j * blockWidth) + ((y + (i * blockHeight)) * width)) * 4 + 3]=pixelData[offset][3];
					offset++;
				}
			}
		}
	}
	
	ctx.putImageData(bannerImageData, 0, 0);

	return bannerImageData;
}
Content.prototype.readIcon=function(){
	this._rawData.seek(this.imageDataOffset + DIRECTORY_SIZE);

	if(this.hasBanner){
		this.banner=Content.imageDataToRGB24(96, 32, this.bannerFormatCI8, this._rawData);
	}

	var iconFrames=[];
	var uniquePalette=false;
	var uniquePaletteOffset=this._rawData.offset;
	for(var i=0; i<MAX_ICONS; i++){
		var frameByte=(this.iconFormat >>> (i*2)) & 0x03;
		if(frameByte===ICON_FORMAT_CI8_UNIQUE_PALETTE){
			iconFrames.push({formatCI8:true, uniquePalette:true});
			uniquePaletteOffset+=32 * 32;
			uniquePalette=true;
		}else if(frameByte===ICON_FORMAT_CI8){
			iconFrames.push({formatCI8:true, uniquePalette:false});
			uniquePaletteOffset+=32 * 32 + 0x0200;
		}else if(frameByte===ICON_FORMAT_RGBA5A3){
			iconFrames.push({formatCI8:false, uniquePalette:false});
			uniquePaletteOffset+=32 * 32 * 2;
		}
	}
	if(uniquePalette){
		uniquePalette=[];
		for(var i=0; i<0x0100; i++)
			uniquePalette.push(Content.convertColor(this._rawData.readU16At(uniquePaletteOffset + i * 2)));
	}

	var iconImageDatas=[];
	for(var i=0; i<iconFrames.length; i++){
		iconImageDatas.push(Content.imageDataToRGB24(32, 32, iconFrames[i].formatCI8, this._rawData, uniquePalette));
	}
	if(this.iconAnimationBackForth){
		var len=iconImageDatas.length;
		for(var i=len-2; i>0; i--){
			iconImageDatas.push(iconImageDatas[i]);
		}
	}
	
	
	this.icon=new ContentIcon(iconImageDatas);

	//canvas.width=32;
	//canvas.height=32;
	return true;
}











/* define BinaryReader additional methods */
BinaryReader.prototype.calculateGcXor=function(len, storeAt){
	var csum=0x0000;
	var inv_csum=0x0000;
	for(var i=0; i<len; i+=2){
		var u16=this.readU16();
		csum += (u16 >>> 0) & 0xffff;
		inv_csum += ((u16 ^ 0xffff)>>>0) & 0xffff;
	}
	if(csum===0xffff)
		csum=0x0000;
	if(inv_csum===0xffff)
		inv_csum=0x0000;

	if(storeAt){
		this.writeU16At(storeAt, csum);
		this.writeU16At(storeAt + 2, inv_csum);
	}else{
		this.writeU16(csum);
		this.writeU16(inv_csum);
	}
}