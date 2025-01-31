/* PSX module for Memory Card Manager JS v20230314 - Marc Robledo 2019-2023 - http://www.marcrobledo.com/license */
/*
	File format specification:
	https://www.psdevwiki.com/ps3/PS1_Savedata#Memory_card_PS1_.28original.29
	https://github.com/ShendoXT/memcardrex/blob/master/MemcardRex/ps1card.cs
*/

const MCR_FRAME_SIZE=0x80;
const MCR_BLOCK_SIZE=0x2000;
const MCR_SIZE=MCR_BLOCK_SIZE*16;
const MCR_MAGIC='MC';
const MCS_MAGIC=['SC','sc','C']; //'sc' (Mega Man X4) and 'C' (PAC-MAN WORLD) found in some saves?

const MASK_BLOCK_AVAILABILITY_AVAILABLE=0xa0;
const MASK_BLOCK_AVAILABILITY_USED=0x50;
const MASK_BLOCK_AVAILABILITY_UNUSABLE=0xf0;
const MASK_BLOCK_LINK_UNUSED=0x00;
const MASK_BLOCK_LINK_START=0x01;
const MASK_BLOCK_LINK_MID=0x02;
const MASK_BLOCK_LINK_END=0x03;
const MASK_BLOCK_LINK_UNUSABLE=0x0f;

const PSX_REGION_JPN='BI';
const PSX_REGION_USA='BA';
const PSX_REGION_EUR='BE';
const PSX_SERIAL_REGIONS_JAP=['SLPS','SLPM','SCPS','SCEI','SCAJ','SIPS','SLKA','ESPM','NPJJ','NPJI'];
const PSX_SERIAL_REGIONS_USA=['SLUS','SCUS','SCEA','NPUJ','NPUI','NPUF','LSP'];
const PSX_SERIAL_REGIONS_EUR=['SLES','SCES','SCEE','SCED','NPEF'];

/* service worker */
const FORCE_HTTPS=true;
if(FORCE_HTTPS && location.protocol==='http:')
	location.href=window.location.href.replace('http:','https:');
/*else if(location.protocol==='https:' && 'serviceWorker' in navigator)
	navigator.serviceWorker.register('/memcard_manager/psx/_cache_service_worker.js', {scope: '/memcard_manager/psx/'});*/




const SYSTEM={
	id:'psx',
	slotLetters:false,
	validExtensions:'.mcr,.mcs',
	exampleFile:'example.mcr',
	infoFields:[
		'gameName'
	],
	editableFields:[
		'identifier',
		'productCode',
		'countryCode',
		'deleted'
	]
}



/* initialize app */
$(document).ready(function(){
	$('#modal-content-productCode').on('change', function(evt){
		var newProductCode=$(this).val().toUpperCase().replace(/[^0-9A-Z\-]+/g, '').substr(0,4);

		var newRegion=REGION_UNKNOWN;
		if(PSX_SERIAL_REGIONS_JAP.indexOf(newProductCode.replace(/-[A-Z0-9]$/,''))!==-1){
			newRegion=PSX_REGION_JPN;
		}else if(PSX_SERIAL_REGIONS_USA.indexOf(newProductCode.replace(/-[A-Z0-9]$/,''))!==-1){
			newRegion=PSX_REGION_USA;
		}else if(PSX_SERIAL_REGIONS_EUR.indexOf(newProductCode.replace(/-[A-Z0-9]$/,''))!==-1){
			newRegion=PSX_REGION_EUR;
		}

		if(newRegion)
			$('#modal-content-countryCode').val(newRegion).data('changed', true);
	});
});




function MemoryCard(arrayBuffer, name){
	this.unsavedChanges=false;
	this.size=15;
	this._rawData=new BinaryReader(arrayBuffer? arrayBuffer : MCR_BLOCK_SIZE, typeof name==='string'? name : 'memcard.mcr');

	this.content=[];
	
	this.buildRawData();
}
MemoryCard.fromArrayBuffer=function(arrayBuffer, name){
	var mcrFile=new BinaryReader(arrayBuffer);

	if(mcrFile.size===MCR_SIZE && mcrFile.readString(2)===MCR_MAGIC){
		var memoryCard=new MemoryCard(mcrFile.slice(0, MCR_BLOCK_SIZE)._u8array.buffer, name);

		memoryCard.content=[];
		for(var i=1; i<=memoryCard.size; i++){
			//extract MCS
			var size=mcrFile.readU8At(MCR_BLOCK_SIZE * i + 0x03);
			if(size && size>=1 && size<=15){
				var mcsFile=new BinaryReader(MCR_FRAME_SIZE + MCR_BLOCK_SIZE*size);
				mcrFile.copyTo(mcsFile, MCR_FRAME_SIZE * i, MCR_FRAME_SIZE, 0x00);
				mcrFile.copyTo(mcsFile, MCR_BLOCK_SIZE * i, MCR_BLOCK_SIZE * size, MCR_FRAME_SIZE);

				var newContent=Content.fromArrayBuffer(mcsFile._u8array);
				if(newContent){
					newContent._rawData.name=newContent.name+'_'+newContent.identifier+'.mcs';
					memoryCard.content.push(newContent);
				}
			}
		}
		return memoryCard;
	}
	return null;
}
MemoryCard.prototype.buildRawData=function(){
	//header
	this._rawData.seek(0);
	this._rawData.writeString(MCR_MAGIC);
	this._rawData.seek(0);
	this._rawData.calculatePsxXor(0x7f);
	this._rawData.seek(0x1f80);
	this._rawData.writeString(MCR_MAGIC);
	this._rawData.seek(0x1f80);
	this._rawData.calculatePsxXor(0x7f);
	
	var frameIndex=1;
	for(var i=0; i<this.content.length; i++){
		this.content[i].buildRawData();
		
		for(var j=0; j<this.content[i].size; j++){
			var isFirstBlock=(j===0);
			var isMiddleBlock=(j>0 && j<this.content[i].size-1);

			if(isFirstBlock){
				this.content[i]._rawData.copyTo(this._rawData, 0x00, MCR_FRAME_SIZE, frameIndex * MCR_FRAME_SIZE);
			}else{
				this._rawData.seek(frameIndex * MCR_FRAME_SIZE);
				this._rawData.fill(MCR_FRAME_SIZE);
			}



			//availability
			var availabilityByte=this.content[i]._rawData.readU8At(0x00) & 0xf0;
			if(isFirstBlock)
				availabilityByte|=1;
			else if(isMiddleBlock)
				availabilityByte|=2;
			else
				availabilityByte|=3;
			this._rawData.writeU8At(frameIndex * MCR_FRAME_SIZE, availabilityByte);
			
			//link order, 0xffff block size=1 or last linked block
			var linkOrder;
			if(this.content[i].size===1 || this.content[i].size===j+1){
				linkOrder=[0xff, 0xff];
			}else{
				linkOrder=[frameIndex, 0x00];
			}
			this._rawData.writeBytesAt((frameIndex * MCR_FRAME_SIZE) + 0x08, linkOrder);


			this._rawData.seek(frameIndex * MCR_FRAME_SIZE);
			this._rawData.calculatePsxXor(0x7f);

			frameIndex++;
		}
	}
	
	for(var i=frameIndex; i<=this.size; i++){
		this._rawData.seek(i * MCR_FRAME_SIZE);
		this._rawData.writeU8(MASK_BLOCK_AVAILABILITY_AVAILABLE |MASK_BLOCK_LINK_UNUSED);
		this._rawData.fill(0x07);
		this._rawData.writeU16(0xffff);
		this._rawData.fill(0x76);
		this._rawData.seek(i * MCR_FRAME_SIZE);
		this._rawData.calculatePsxXor(0x7f);

		this._rawData.seek(MCR_BLOCK_SIZE + i*MCR_BLOCK_SIZE);
		this._rawData.fill(MCR_BLOCK_SIZE);
	}

	for(var i=0; i<20; i++){
		this._rawData.seek(0x800+i*0x80);
		this._rawData.writeU32(0xffffffff);
		this._rawData.skip(4);
		this._rawData.writeU16(0xffff);
	}

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
		summary: UI.getFreeBlocksString(freeBlocks)
	}
}

MemoryCard.prototype.export=function(){
	this.buildRawData();

	var mcrFile=new BinaryReader(MCR_BLOCK_SIZE + this.size*MCR_BLOCK_SIZE);
	this._rawData.copyTo(mcrFile, 0x00, MCR_BLOCK_SIZE, 0x00);
	var block=1;
	for(var i=0; i<this.content.length; i++){
		this.content[i]._rawData.copyTo(mcrFile, MCR_FRAME_SIZE, this.content[i].size * MCR_BLOCK_SIZE, MCR_BLOCK_SIZE*block);
		block+=this.content[i].size;
	}
	mcrFile.name=this._rawData.name;
	return mcrFile;
}

MemoryCard.prototype.importContent=function(content){
	var freeBlocks=this.getFreeBlocks();

	if(content.size <= freeBlocks){
		this.content.push(content);
		return true;
	}else{
		return false;
	}
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























function Content(arrayBuffer){
	this._rawData=new BinaryReader(arrayBuffer);
	this.size=(this._rawData.size-0x80)/MCR_BLOCK_SIZE;

	/* parse data */
	this.blockAvailability=this._rawData.readU8At(0x00);
	this.deleted=(this.blockAvailability & 0xf0)===MASK_BLOCK_AVAILABILITY_AVAILABLE;

	this._rawData.seek(0x00 + 0x0a);
	this.countryCode=this._rawData.readString(2); //BI=Japan, BA=America, BE=Europe
	this.productCode=this._rawData.readString(10);
	this.identifier=this._rawData.readString(8);
	
	this._rawData.seek(0x80 + 0x02);
	var howManyIcons=this._rawData.readU8();
	if(howManyIcons>=0x11 && howManyIcons<=0x13){
		this.icon=new ContentIcon(this.readIcon(howManyIcons & 0x03));
	}

	this._rawData.seek(0x80 + 0x04);
	this.gameName='';
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
	}
}
Content.fromArrayBuffer=function(arrayBuffer){
	var file=new BinaryReader(arrayBuffer);

	file.seek(0x80);
	if(
		(file.size-MCR_FRAME_SIZE)%MCR_BLOCK_SIZE===0 && (MCS_MAGIC.indexOf(file.readString(2))!==-1)){
		return new Content(arrayBuffer);
	}

	return null;
}

Content.prototype.export=function(){
	this.buildRawData();

	return this._rawData.slice();
}
Content.prototype.buildRawData=function(){
	this._rawData.seek(0x00);
	this._rawData.calculatePsxXor(0x7f);

	var fileName=this.gameName;
	if(this.identifier)
		fileName+='_'+this.identifier;
	this._rawData.name=fileName+'.mcs';
	return this._rawData._u8array.buffer;
}
Content.prototype.info=function(){
	var region;
	if(this.countryCode===PSX_REGION_JPN)
		region=REGION_JPN;
	else if(this.countryCode===PSX_REGION_USA)
		region=REGION_USA;
	else if(this.countryCode===PSX_REGION_EUR)
		region=REGION_EUR;
	else
		region=REGION_UNKNOWN;

	var summary=UI.monoText(this.productCode) + ' ' + UI.getFlagIcon(region) + ' ';
	summary+=UI.getBlocksString(this.size);

	return {
		region:region,
		productCode:this.productCode,
		blocks:this.size,
		identifier:this.identifier.trim()?this.identifier:'',
		name:this.gameName.replace(/</g,'&lt;').replace(/>/g,'&gt;'),
		summary:summary
	};
}

Content.prototype.setIdentifier=function(identifier){
	if(typeof identifier !== 'string')
		return false;

	this.identifier=identifier;
	this._rawData.writeStringAt(0x16, this.identifier, 8);
}
Content.prototype.setProductCode=function(productCode){
	if(typeof productCode !== 'string')
		return false;

	this.productCode=productCode;
	this._rawData.writeStringAt(0x0c, this.productCode, 10);
}
Content.prototype.setDeleted=function(deleted){
	this.deleted=!!deleted;
	this.blockAvailability=this._rawData.readU8At(0x00) & 0x0f;
	if(this.deleted)
		this.blockAvailability|=MASK_BLOCK_AVAILABILITY_AVAILABLE;
	else
		this.blockAvailability|=MASK_BLOCK_AVAILABILITY_USED;

	this._rawData.writeU8At(0x00, this.blockAvailability);
}

Content.prototype.setCountryCode=function(countryCode){
	if(typeof countryCode !== 'string')
		return false;

	this.countryCode=countryCode;
	this._rawData.writeStringAt(0x0a, countryCode, 2);
}

Content.prototype.readIcon=function(numFrames){
	//read palette
	this._rawData.seek(0x80+0x60);
	var palette=new Array(16);
	for(var i=0; i<16; i++){
		var colorInfo1=this._rawData.readU8();
		var colorInfo2=this._rawData.readU8();

		palette[i]={
			r:(colorInfo1 & 0x1f) << 3,
			g:((colorInfo2 & 0x03) << 6) | ((colorInfo1 & 0xe0) >> 2),
			b:((colorInfo2 & 0x7c) << 1),
			blackFlag:(colorInfo2 & 0x80)
		};
	}

	var canvas=document.createElement('canvas');
	canvas.width=16;
	canvas.height=16;
	var ctx=canvas.getContext('2d');

	var animationFrames=new Array(numFrames);

	
	for(var i=0; i<numFrames; i++){
		animationFrames[i]=ctx.createImageData(16,16);
		for(var j=0; j<(16*16)/2; j++){
			var colorBytes=this._rawData.readU8();

			var colorByte1=colorBytes & 0x0f;
			var colorByte2=colorBytes>>4;

			animationFrames[i].data[(j*8)+0]=palette[colorByte1].r;
			animationFrames[i].data[(j*8)+1]=palette[colorByte1].g;
			animationFrames[i].data[(j*8)+2]=palette[colorByte1].b;
			animationFrames[i].data[(j*8)+3]=0xff;

			animationFrames[i].data[(j*8)+4]=palette[colorByte2].r;
			animationFrames[i].data[(j*8)+5]=palette[colorByte2].g;
			animationFrames[i].data[(j*8)+6]=palette[colorByte2].b;
			animationFrames[i].data[(j*8)+7]=0xff;
		}
	}

	return animationFrames
}











/* define BinaryReader additional methods */
BinaryReader.prototype.seekToFrameOffset=function(f){
	this.seek(f*MCR_FRAME_SIZE);
}
BinaryReader.prototype.seekToBlockOffset=function(b){
	this.seek((b+1)*MCR_BLOCK_SIZE);
}
BinaryReader.prototype.calculatePsxXor=function(len){
	var xor=0x00;
	for(var i=0; i<len; i++){
		xor ^= this.readU8();
	}
	this.writeU8(xor);
}
