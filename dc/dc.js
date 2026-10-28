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
		'vmuIconColor',
		'vmuIconMono'
	]
}

window.addEventListener('DOMContentLoaded', function(){
	document.getElementById('btn-content-edit').addEventListener('click', function(){
		document.getElementById('modal-content-row-eyecatch').classList.toggle('hide', !currentContent.eyecatch);
		document.getElementById('modal-content-row-vmu-icons').classList.toggle('hide', !currentContent.isVMUIcon());
	});



	function bindVMUIconButton(buttonId){
		var input=document.getElementById('input-file-vmu-icon-' + buttonId);
		input.addEventListener('change', function(){
			var file=this.files[0];
			this.value='';
			if(!file || !currentContent || !currentContent.isVMUIcon())
				return;

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
				if(img.naturalWidth!==ICON_SIZE || img.naturalHeight!==ICON_SIZE){
					alert('Image must be '+ICON_SIZE+'x'+ICON_SIZE+' pixels');
					return;
				}





				var canvas=document.createElement('canvas');
				canvas.width=ICON_SIZE;
				canvas.height=ICON_SIZE;
				var ctx=canvas.getContext('2d', {willReadFrequently:true});
				ctx.drawImage(img, 0, 0);
				var imageData=ctx.getImageData(0, 0, ICON_SIZE, ICON_SIZE);
				var colors=[];
				var readIndex=0;
				for(var y=0; y<ICON_SIZE; y++){
					for(var x=0; x<ICON_SIZE; x++){
						var r=imageData.data[readIndex + 0];
						var g=imageData.data[readIndex + 1];
						var b=imageData.data[readIndex + 2];
						var a=imageData.data[readIndex + 3];
						readIndex+=4;

						if(buttonId==='mono'){
							var alpha=a / 255;
							var luma=(0.299 * r + 0.587 * g + 0.114 * b) * alpha + 255 * (1 - alpha);
							if(luma<128){
								r=g=b=0;
							}else{
								r=g=b=255;
							}
							a=255;
						}

						//check if color exists in the array
						var exists=colors.some(function(c){
							return c[0]===r && c[1]===g && c[2]===b && c[3]===a;
						});
						if(!exists){
							colors.push([r, g, b, a]);
							if(buttonId==='color' && colors.length>16){
								alert('Icon image contains more than 16 colors');
								return;
							}else if(buttonId==='mono' && colors.length>2){
								alert('Monochrome icon image contains more than 2 colors');
								return;
							}
						}
					}
				}

				var finalCanvas=$('#modal-content-vmuIcon' + (buttonId==='mono'? 'Mono' : 'Color'));
				finalCanvas.data('changed', true);
				var ctx2=finalCanvas.get(0).getContext('2d');
				ctx2.clearRect(0, 0, canvas.width, canvas.height);
				ctx2.putImageData(imageData, 0, 0);
				refreshHtml(currentMemoryCard);
			};
			img.src=url;
		});
		var button=document.getElementById('btn-vmu-icon-' + buttonId);
		button.addEventListener('click', function(){
			input.click();
		});
	}

	bindVMUIconButton('mono');
	bindVMUIconButton('color');
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
	if(this.isVMUIcon()){
		//ICONDATA_VMS uses a special structure, overwriting some header bytes like comment2 and eyecatch
		this.comment1=UI.escapeHTML(Content.readText(this._rawData, DIRECTORY_ENTRY_SIZE + HEADER_DESCRIPTION_SHORT, 16));
	}else if(headerOffset + HEADER_ICON_BITMAPS <= this._rawData.size){
		this.comment1=UI.escapeHTML(Content.readText(this._rawData, headerOffset + HEADER_DESCRIPTION_SHORT, 16));
		this.comment2=UI.escapeHTML(Content.readText(this._rawData, headerOffset + HEADER_DESCRIPTION_LONG, 32));
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

	var iconCount=this._rawData.readU16At(headerOffset + HEADER_ICON_COUNT);
	var iconSpeed=this._rawData.readU16At(headerOffset + HEADER_ICON_SPEED);
	var eyecatchType=this._rawData.readU16At(headerOffset + HEADER_EYECATCH_TYPE);

	var iconsOffset=headerOffset + HEADER_ICON_BITMAPS;
	var eyecatchOffset=iconsOffset + iconCount * ICON_BYTES;
	if(eyecatchOffset>this._rawData.size)
		return false;

	if(iconCount>0){
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



Content.prototype.getRowStyle=function(){
	if(this.copyProtected)
		return 'copy-protected';
	if(this.isVMUIcon())
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
