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

const CONTENT_HEADER_DESCRIPTION_SHORT=0x00;
const CONTENT_HEADER_DESCRIPTION_LONG=0x10;
const CONTENT_HEADER_ICON_COUNT=0x40;
const CONTENT_HEADER_ICON_SPEED=0x42;
const CONTENT_HEADER_EYECATCH_TYPE=0x44;
const CONTENT_HEADER_CRC=0x46;
const CONTENT_HEADER_DATA_SIZE=0x48;
const CONTENT_ICON_PALETTE=0x60;
const CONTENT_ICON_BITMAPS=0x80;
const ICON_SIZE=32;
const ICON_BYTES=ICON_SIZE * ICON_SIZE / 2;

const EYECATCH_WIDTH=72;
const EYECATCH_HEIGHT=56;
const EYECATCH_NONE=0x00;
const EYECATCH_ARGB4444=0x01;
const EYECATCH_PALETTE_256=0x02;
const EYECATCH_PALETTE_16=0x03;

const VMU_ICON_FILENAME='ICONDATA_VMS';
const VMU_ICON_OFFSET_MONOCHROME=0x10;
const VMU_ICON_OFFSET_COLOR=0x14;
const VMU_ICON_MONOCHROME_LENGTH=32 * 32 / 8;
const VMU_ICON_COLOR_LENGTH=32 + ICON_BYTES;
const VMU_ICON_REAL_MODE_OFFSET=0x2c0; //allows enabling 'Real Mode' by pressing Start button while in Dashboard
const VMU_ICON_REAL_MODE_MAGIC=[0xda, 0x69, 0xd0, 0xda, 0xc7, 0x4e, 0xf8, 0x36, 0x18, 0x92, 0x79, 0x68, 0x2d, 0xb5, 0x30, 0x86];

const EXTRA_BG_FILENAME='EXTRA.BG.PVR';
const EXTRA_BG_SIZE=256;
const EYECATCH_LENGTHS=[0, 8064, 4544, 2048];
const PVR_PIXEL_ARGB1555=0x00;
const PVR_PIXEL_RGB565=0x01;
const PVR_PIXEL_ARGB4444=0x02;
const PVR_DATA_TWIDDLED=0x01;
const PVR_DATA_VQ=0x03;
const PVR_DATA_RECTANGLE=0x09;
const PVR_DATA_SMALL_VQ=0x10;
const PVR_VQ_CODEBOOK_ENTRIES=256;
const PVR_VQ_ENTRY_LENGTH=8; //2x2 texels, 16 bits each
const EXTRA_BG_PVR_LENGTH=16 + 8 + 8 + PVR_VQ_CODEBOOK_ENTRIES * PVR_VQ_ENTRY_LENGTH + (EXTRA_BG_SIZE / 2) * (EXTRA_BG_SIZE / 2); //GBIX (16) + PVRT magic and length (8) + texture header (8) + codebook + 128x128 indices




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
		'copyProtected',
		'realMode',
		'vmuIconColor',
		'vmuIconMono',
		'background'
	]
}

window.addEventListener('DOMContentLoaded', function(){
	document.getElementById('btn-content-edit').addEventListener('click', function(){
		document.getElementById('modal-content-row-eyecatch').classList.toggle('hide', !currentContent.eyecatch);
		document.getElementById('modal-content-row-vmu-icons').classList.toggle('hide', !currentContent.isVMUIcon());
		document.getElementById('modal-content-row-real-mode').classList.toggle('hide', !currentContent.isVMUIcon());
		document.getElementById('modal-content-realMode').disabled=!currentContent.supportsRealMode();
		document.getElementById('modal-content-row-background').classList.toggle('hide', !currentContent.isExtraBackground());
	});

	//reads a PNG file and gives its pixels to the callback, alerting if it is not valid or has other dimensions
	function loadPNGImageData(file, width, height, callback){
		var url=URL.createObjectURL(file);
		var img=new Image();
		img.onerror=function(){
			URL.revokeObjectURL(url);
			alert('Invalid PNG image');
		};
		img.onload=function(){
			URL.revokeObjectURL(url);
			if(file.type!=='image/png'){
				alert('Invalid PNG image');
				return;
			}
			if(img.naturalWidth!==width || img.naturalHeight!==height){
				alert('Image must be '+width+'x'+height+' pixels');
				return;
			}

			var canvas=document.createElement('canvas');
			canvas.width=width;
			canvas.height=height;
			var ctx=canvas.getContext('2d', {willReadFrequently:true});
			ctx.drawImage(img, 0, 0);
			callback(ctx.getImageData(0, 0, width, height));
		};
		img.src=url;
	}



	function bindVMUIconButton(buttonId){
		var input=document.getElementById('input-file-vmu-icon-' + buttonId);
		input.addEventListener('change', function(){
			var file=this.files[0];
			this.value='';
			if(!file || !currentContent || !currentContent.isVMUIcon())
				return;

			loadPNGImageData(file, ICON_SIZE, ICON_SIZE, function(imageData){
				var finalCanvas=$('#modal-content-vmuIcon' + (buttonId==='mono'? 'Mono' : 'Color'));
				finalCanvas.data('changed', true);
				var ctx2=finalCanvas.get(0).getContext('2d');
				ctx2.clearRect(0, 0, ICON_SIZE, ICON_SIZE);
				ctx2.putImageData(imageData, 0, 0);
				refreshHtml(currentMemoryCard);
			});
		});
		var button=document.getElementById('btn-vmu-icon-' + buttonId);
		button.addEventListener('click', function(){
			input.click();
		});
	}
	bindVMUIconButton('mono');
	bindVMUIconButton('color');


	document.getElementById('btn-background').addEventListener('click', function(){
		document.getElementById('input-file-background').click();
	});
	document.getElementById('input-file-background').addEventListener('change', function(){
		var file=this.files[0];
		this.value='';
		if(!file || !currentContent || !currentContent.isExtraBackground())
			return;

		loadPNGImageData(file, EXTRA_BG_SIZE, EXTRA_BG_SIZE, function(imageData){
			if(currentContent.getBackgroundBlocks() - currentContent.size>currentMemoryCard.getFreeBlocks()){
				alert('Not enough free blocks in the memory card (needs ' + currentContent.getBackgroundBlocks() + ' blocks)');
				return;
			}

			var canvas=$('#modal-content-background');
			canvas.data('changed', true);
			canvas.get(0).getContext('2d').putImageData(imageData, 0, 0);
		});
	});
});







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

	this.readIcon(headerOffset);
	if(this.isExtraBackground())
		this.parseBackground();
	if(this.isVMUIcon()){
		//ICONDATA_VMS uses a special structure, overwriting some header bytes like comment2 and eyecatch
		this.comment1=UI.escapeHTML(Content.readText(this._rawData, DIRECTORY_ENTRY_SIZE + CONTENT_HEADER_DESCRIPTION_SHORT, 16));
	}else if(headerOffset + CONTENT_ICON_BITMAPS <= this._rawData.size){
		this.comment1=UI.escapeHTML(Content.readText(this._rawData, headerOffset + CONTENT_HEADER_DESCRIPTION_SHORT, 16));
		this.comment2=UI.escapeHTML(Content.readText(this._rawData, headerOffset + CONTENT_HEADER_DESCRIPTION_LONG, 32));
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
Content.calculateCRC=function(u8array, offset, length){
	var n=0;
	for(var i=0; i<length; i++){
		n^=u8array[offset + i] << 8;
		for(var c=0; c<8; c++)
			n=((n & 0x8000)? ((n << 1) ^ 0x1021) : (n << 1)) & 0xffff;
	}
	return n;
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
Content.convertColor=function(argb4444, keepAlpha){
	return [
		((argb4444 >>> 8) & 0x0f) * 17,
		((argb4444 >>> 4) & 0x0f) * 17,
		(argb4444 & 0x0f) * 17,
		keepAlpha? ((argb4444 >>> 12) & 0x0f) * 17 : 255
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
	if(this.isVMUIcon())
		return this.parseVMUIcons();

	var iconCount=this._rawData.readU16At(headerOffset + CONTENT_HEADER_ICON_COUNT);
	var iconSpeed=this._rawData.readU16At(headerOffset + CONTENT_HEADER_ICON_SPEED);
	var eyecatchType=this._rawData.readU16At(headerOffset + CONTENT_HEADER_EYECATCH_TYPE);

	var iconsOffset=headerOffset + CONTENT_ICON_BITMAPS;
	var eyecatchOffset=iconsOffset + iconCount * ICON_BYTES;
	if(eyecatchOffset>this._rawData.size)
		return false;

	if(iconCount>0){
		var palette=[];
		for(var i=0; i<16; i++)
			palette.push(Content.convertColor(this._rawData.readU16At(headerOffset + CONTENT_ICON_PALETTE + i * 2)));

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
	}
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

	return this.icon || this.eyecatch;
}
Content.prototype.isVMUIcon=function(){
	return this.fileType===FILE_TYPE_DATA && this.fileName===VMU_ICON_FILENAME;
}
Content.prototype.parseVMUIcons=function(){
	var rawData=this._rawData;
	var base=DIRECTORY_ENTRY_SIZE;
	this.realMode=this.supportsRealMode() && VMU_ICON_REAL_MODE_MAGIC.every(function(b, i){
		return rawData.readU8At(base + VMU_ICON_REAL_MODE_OFFSET + i)===b;
	});

	var monoOffset=rawData.readU32At(base + VMU_ICON_OFFSET_MONOCHROME);
	var colorOffset=rawData.readU32At(base + VMU_ICON_OFFSET_COLOR);
	var white=[255, 255, 255, 255], black=[0, 0, 0, 255];

	if(monoOffset>0 && base + monoOffset + VMU_ICON_MONOCHROME_LENGTH <= rawData.size){
		this.vmuIconMono=Content.paletteToImageData(ICON_SIZE, ICON_SIZE, function(p){
			return (rawData.readU8At(base + monoOffset + (p >> 3)) >> (7 - (p & 7))) & 1;
		}, [white, black]);
	}

	if(colorOffset>0 && base + colorOffset + VMU_ICON_COLOR_LENGTH <= rawData.size){
		var palette=[];
		for(var i=0; i<16; i++)
			palette.push(Content.convertColor(rawData.readU16At(base + colorOffset + i * 2), true));
		this.vmuIconColor=Content.paletteToImageData(ICON_SIZE, ICON_SIZE, function(p){
			var b=rawData.readU8At(base + colorOffset + 32 + (p >> 1));
			return (p & 1)? (b & 0x0f) : (b >> 4);
		}, palette);
	}

	var vmuIcon=this.vmuIconColor || this.vmuIconMono;
	if(vmuIcon){
		if(this.icon){
			this.icon.imageDatas=[vmuIcon];
			this.icon.frame=0;
			this.icon.ctx.putImageData(vmuIcon, 0, 0);
		}else{
			this.icon=new ContentIcon([vmuIcon]);
		}
	}

	return this.icon;
}
Content.prototype.supportsRealMode=function(){
	return this.isVMUIcon() && DIRECTORY_ENTRY_SIZE + VMU_ICON_REAL_MODE_OFFSET + VMU_ICON_REAL_MODE_MAGIC.length<=this._rawData.size;
}
Content.prototype.setRealMode=function(enabled){
	if(!this.supportsRealMode())
		return false;

	this.realMode=!!enabled;
	for(var i=0; i<VMU_ICON_REAL_MODE_MAGIC.length; i++)
		this._rawData.writeU8At(DIRECTORY_ENTRY_SIZE + VMU_ICON_REAL_MODE_OFFSET + i, this.realMode? VMU_ICON_REAL_MODE_MAGIC[i] : 0x00);
	return true;
}
Content.prototype.setVmuIconColor=function(imageData){
	if(!this.isVMUIcon())
		throw new Error('No VMU icon to replace.');

	var palette=[];
	var pixels=[];

	for(var i=0; i<imageData.data.length; i+=4){
		var r=imageData.data[i + 0];
		var g=imageData.data[i + 1];
		var b=imageData.data[i + 2];
		var a=imageData.data[i + 3];

		var argb4444=Math.round(a / 17)? ((Math.round(a / 17) << 12) | (Math.round(r / 17) << 8) | (Math.round(g / 17) << 4) | Math.round(b / 17)) : 0;
		var index=palette.indexOf(argb4444);
		if(index===-1){
			index=palette.length;
			palette.push(argb4444);
		}
		pixels.push(index);
	}


	var rawData=this._rawData;
	var base=DIRECTORY_ENTRY_SIZE;

	if(palette.length>16)
		throw new Error('VMU Icon Color has more than 16 colors.');

	//the color icon is added if the file doesn't have one
	var monoOffset=rawData.readU32At(base + VMU_ICON_OFFSET_MONOCHROME);
	var offset=rawData.readU32At(base + VMU_ICON_OFFSET_COLOR)  || (monoOffset + VMU_ICON_MONOCHROME_LENGTH);
	if(base + offset + VMU_ICON_COLOR_LENGTH>rawData.size)
		throw new Error('ICONDATA_VMS file has no room for a color icon.');

	rawData.writeU32At(base + VMU_ICON_OFFSET_COLOR, offset);
	for(var i=0; i<16; i++)
		rawData.writeU16At(base + offset + i * 2, palette[i] || 0);
	for(var i=0; i<ICON_BYTES; i++)
		rawData.writeU8At(base + offset + 32 + i, (pixels[i * 2] << 4) | pixels[i * 2 + 1]);

	this.parseVMUIcons();
}
Content.prototype.setVmuIconMono=function(imageData){
	if(!this.isVMUIcon())
		throw new Error('No VMU icon to replace.');

	var pixels=[];

	for(var i=0; i<imageData.data.length; i+=4){
		var r=imageData.data[i + 0];
		var g=imageData.data[i + 1];
		var b=imageData.data[i + 2];
		var a=imageData.data[i + 3];

		var alpha=a / 255;
		var luma=(0.299 * r + 0.587 * g + 0.114 * b) * alpha + 255 * (1 - alpha);
		pixels.push(luma<128);
	}


	var rawData=this._rawData;
	var base=DIRECTORY_ENTRY_SIZE;
	var offset=rawData.readU32At(base + VMU_ICON_OFFSET_MONOCHROME);
	if(offset<1 || base + offset + VMU_ICON_MONOCHROME_LENGTH>rawData.size)
		throw new Error('Invalid ICONDATA_VMS file.');

	for(var i=0; i<VMU_ICON_MONOCHROME_LENGTH; i++)
		rawData.writeU8At(base + offset + i, 0x00);
	for(var i=0; i<pixels.length; i++){
		if(pixels[i])
			rawData.writeU8At(base + offset + (i >> 3), rawData.readU8At(base + offset + (i >> 3)) | (0x80 >> (i & 7)));
	}

	this.parseVMUIcons();
}


Content.prototype.isExtraBackground=function(){
	return this.fileType===FILE_TYPE_DATA && this.fileName===EXTRA_BG_FILENAME;
}
Content.prototype.getPVROffset=function(){
	var rawData=this._rawData;
	var headerOffset=DIRECTORY_ENTRY_SIZE + this.headerOffset * BLOCK_SIZE;
	var iconCount=rawData.readU16At(headerOffset + CONTENT_HEADER_ICON_COUNT);
	var eyecatchLength=EYECATCH_LENGTHS[rawData.readU16At(headerOffset + CONTENT_HEADER_EYECATCH_TYPE)] || 0;
	return headerOffset + CONTENT_ICON_BITMAPS + iconCount * ICON_BYTES + eyecatchLength;
}
Content.prototype.getBackgroundBlocks=function(){
	return Math.ceil((this.getPVROffset() - DIRECTORY_ENTRY_SIZE + EXTRA_BG_PVR_LENGTH) / BLOCK_SIZE);
}
Content.prototype.parseBackground=function(){
	this.background=Content.decodePVR(this._rawData, this.getPVROffset());
	return this.background;
}
Content.prototype.setBackground=function(imageData){
	if(!this.isExtraBackground())
		throw new Error('No background to replace.');
	if(imageData.width!==EXTRA_BG_SIZE || imageData.height!==EXTRA_BG_SIZE)
		throw new Error('Background must be ' + EXTRA_BG_SIZE + 'x' + EXTRA_BG_SIZE + '.');

	var pvr=Content.encodePVR(imageData);
	var pvrOffset=this.getPVROffset();
	var fileLength=pvrOffset - DIRECTORY_ENTRY_SIZE + pvr.length;
	var blocks=Math.ceil(fileLength / BLOCK_SIZE);

	var newRawData=new BinaryReader(DIRECTORY_ENTRY_SIZE + blocks * BLOCK_SIZE, this._rawData.name);
	newRawData.littleEndian=true;
	this._rawData.copyTo(newRawData, 0, pvrOffset, 0);
	newRawData._u8array.set(pvr, pvrOffset);

	var headerOffset=DIRECTORY_ENTRY_SIZE + this.headerOffset * BLOCK_SIZE;
	newRawData.writeU16At(DIRECTORY_ENTRY_FILESIZE, blocks);
	newRawData.writeU32At(headerOffset + CONTENT_HEADER_DATA_SIZE, pvr.length);
	newRawData.writeU16At(headerOffset + CONTENT_HEADER_CRC, Content.calculateCRC(newRawData._u8array, DIRECTORY_ENTRY_SIZE, fileLength));

	this._rawData=newRawData;
	this.size=blocks;
	this.parseBackground();
}

/* PVR textures */
Content.twiddle=function(x, y){
	var index=0;
	for(var i=0; i<16; i++)
		index|=(((y >> i) & 1) << (2 * i)) | (((x >> i) & 1) << (2 * i + 1));
	return index;
}
Content.convertPVRColor=function(value, pixelFormat){
	if(pixelFormat===PVR_PIXEL_ARGB4444)
		return Content.convertColor(value, true);

	var expand=function(v, bits){
		return Math.round(v * 255 / ((1 << bits) - 1));
	};
	if(pixelFormat===PVR_PIXEL_RGB565)
		return [expand((value >> 11) & 0x1f, 5), expand((value >> 5) & 0x3f, 6), expand(value & 0x1f, 5), 255];
	return [expand((value >> 10) & 0x1f, 5), expand((value >> 5) & 0x1f, 5), expand(value & 0x1f, 5), (value & 0x8000)? 255 : 0];
}
//returns the texture stretched to EXTRA_BG_SIZE x EXTRA_BG_SIZE (top row first), or null if it is not supported
Content.decodePVR=function(rawData, offset){
	if(offset + 16>rawData.size)
		return null;
	if(rawData.readStringAt(offset, 4)==='GBIX')
		offset+=8 + rawData.readU32At(offset + 4);
	if(offset + 16>rawData.size || rawData.readStringAt(offset, 4)!=='PVRT')
		return null;

	var pixelFormat=rawData.readU8At(offset + 8);
	var dataFormat=rawData.readU8At(offset + 9);
	var width=rawData.readU16At(offset + 12);
	var height=rawData.readU16At(offset + 14);
	var data=offset + 16;
	if(pixelFormat>PVR_PIXEL_ARGB4444 || width<2 || height<2 || width>EXTRA_BG_SIZE || height>EXTRA_BG_SIZE)
		return null;

	var getTexel;
	if(dataFormat===PVR_DATA_VQ || dataFormat===PVR_DATA_SMALL_VQ){
		if(width!==height)
			return null;
		var entries=PVR_VQ_CODEBOOK_ENTRIES;
		if(dataFormat===PVR_DATA_SMALL_VQ)
			entries=(width<=16)? 16 : (width<=32)? 32 : (width<=64)? 128 : 256;
		var indices=data + entries * PVR_VQ_ENTRY_LENGTH;
		if(indices + (width / 2) * (height / 2)>rawData.size)
			return null;
		getTexel=function(x, y){
			var entry=rawData.readU8At(indices + Content.twiddle(x >> 1, y >> 1));
			return rawData.readU16At(data + entry * PVR_VQ_ENTRY_LENGTH + (((x & 1) << 1) | (y & 1)) * 2);
		};
	}else if(dataFormat===PVR_DATA_TWIDDLED && width===height && data + width * height * 2<=rawData.size){
		getTexel=function(x, y){
			return rawData.readU16At(data + Content.twiddle(x, y) * 2);
		};
	}else if(dataFormat===PVR_DATA_RECTANGLE && data + width * height * 2<=rawData.size){
		getTexel=function(x, y){
			return rawData.readU16At(data + (y * width + x) * 2);
		};
	}else{
		return null;
	}

	var imageData=new ImageData(EXTRA_BG_SIZE, EXTRA_BG_SIZE);
	var colors={};
	for(var y=0; y<EXTRA_BG_SIZE; y++){
		for(var x=0; x<EXTRA_BG_SIZE; x++){
			var texel=getTexel(Math.floor(x * width / EXTRA_BG_SIZE), Math.floor(y * height / EXTRA_BG_SIZE));
			if(!colors[texel])
				colors[texel]=Content.convertPVRColor(texel, pixelFormat);
			imageData.data.set(colors[texel], (y * EXTRA_BG_SIZE + x) * 4);
		}
	}
	return imageData;
}
Content.encodePVR=function(imageData){
	var side=EXTRA_BG_SIZE / 2;
	var blocks=side * side;
	var K=PVR_VQ_CODEBOOK_ENTRIES;

	//each 2x2 block is a 12-value vector, texels ordered like the codebook
	var vectors=new Float32Array(blocks * 12);
	for(var by=0; by<side; by++){
		for(var bx=0; bx<side; bx++){
			for(var k=0; k<4; k++){
				var i=((by * 2 + (k & 1)) * EXTRA_BG_SIZE + bx * 2 + (k >> 1)) * 4;
				var alpha=imageData.data[i + 3] / 255;
				for(var c=0; c<3; c++)
					vectors[(by * side + bx) * 12 + k * 3 + c]=imageData.data[i + c] * alpha;
			}
		}
	}

	//k-means, starting from blocks evenly spread along their brightness
	var order=[];
	var brightness=new Float32Array(blocks);
	for(var b=0; b<blocks; b++){
		order.push(b);
		for(var t=0; t<12; t++)
			brightness[b]+=vectors[b * 12 + t];
	}
	order.sort(function(a, b){return brightness[a] - brightness[b]});
	var centroids=new Float32Array(K * 12);
	for(var j=0; j<K; j++)
		centroids.set(vectors.subarray(order[Math.floor((j + 0.5) * blocks / K)] * 12, order[Math.floor((j + 0.5) * blocks / K)] * 12 + 12), j * 12);

	var assignment=new Uint16Array(blocks);
	var seed=1;
	for(var iteration=0; iteration<=8; iteration++){
		var sums=new Float64Array(K * 12);
		var counts=new Uint32Array(K);
		for(var b=0; b<blocks; b++){
			var best=0, bestDistance=Infinity;
			for(var j=0; j<K; j++){
				var distance=0;
				for(var t=0; t<12 && distance<bestDistance; t++){
					var diff=vectors[b * 12 + t] - centroids[j * 12 + t];
					distance+=diff * diff;
				}
				if(distance<bestDistance){
					bestDistance=distance;
					best=j;
				}
			}
			assignment[b]=best;
			counts[best]++;
			for(var t=0; t<12; t++)
				sums[best * 12 + t]+=vectors[b * 12 + t];
		}

		if(iteration===8)
			break;
		for(var j=0; j<K; j++){
			if(counts[j]){
				for(var t=0; t<12; t++)
					centroids[j * 12 + t]=sums[j * 12 + t] / counts[j];
			}else{
				seed=(seed * 1103515245 + 12345) & 0x7fffffff;
				centroids.set(vectors.subarray((seed % blocks) * 12, (seed % blocks) * 12 + 12), j * 12);
			}
		}
	}

	var out=new Uint8Array(EXTRA_BG_PVR_LENGTH);
	var view=new DataView(out.buffer);
	out.set([0x47, 0x42, 0x49, 0x58], 0); //GBIX
	view.setUint32(4, 8, true);
	view.setUint32(8, 666, true); //GBIX index, a texture with index 0 is not shown by the dashboard
	out.set([0x50, 0x56, 0x52, 0x54], 16); //PVRT
	view.setUint32(20, EXTRA_BG_PVR_LENGTH - 24, true);
	view.setUint8(24, PVR_PIXEL_RGB565);
	view.setUint8(25, PVR_DATA_VQ);
	view.setUint16(28, EXTRA_BG_SIZE, true);
	view.setUint16(30, EXTRA_BG_SIZE, true);

	var codebook=32;
	for(var j=0; j<K; j++){
		for(var k=0; k<4; k++){
			var r=Math.round(centroids[j * 12 + k * 3] * 31 / 255);
			var g=Math.round(centroids[j * 12 + k * 3 + 1] * 63 / 255);
			var b=Math.round(centroids[j * 12 + k * 3 + 2] * 31 / 255);
			view.setUint16(codebook + j * PVR_VQ_ENTRY_LENGTH + k * 2, (r << 11) | (g << 5) | b, true);
		}
	}
	var indices=codebook + K * PVR_VQ_ENTRY_LENGTH;
	for(var by=0; by<side; by++){
		for(var bx=0; bx<side; bx++)
			out[indices + Content.twiddle(bx, by)]=assignment[by * side + bx];
	}
	return out;
}


Content.prototype.getRowStyle=function(){
	if(this.copyProtected)
		return 'copy-protected';
	if(this.isVMUIcon() || this.isExtraBackground())
		return 'special';
	return '';
}




/* helper functions */
function toBCD(n){
	return ((Math.floor(n / 10) % 10) << 4) | (n % 10);
}
function fromBCD(b){
	return ((b >> 4) * 10) + (b & 0x0f);
}
