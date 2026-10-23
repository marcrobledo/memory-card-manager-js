/*
* Nintendo 64 Controller Pak implementation for Memory Card Manager JS
*
* Released under no license, feel free to do whatever you want with it without restrictions
*/

/*
	File format specification:
	https://n64brew.dev/wiki/Controller_Pak/Filesystem

	32 KiB split in 256-byte pages: page 0 is the ID sector (four copies of an ID block, each with two checksums),
	pages 1 and 2 are the allocation table (FAT) and its backup (with an 8-bit checksum),
	pages 3 and 4 are the note table (16 entries of 32 bytes) and pages 5-127 hold the notes' data.
*/

const RAW_SIZE=0x40000;
const PAGE_SIZE=0x100;
const PAGE_COUNT=128;
const FIRST_NOTE_PAGE=5;
const USABLE_PAGES=PAGE_COUNT - FIRST_NOTE_PAGE;
const MAX_NOTES=16;

const ID_BLOCK_OFFSETS=[0x20, 0x60, 0x80, 0xc0];
const ID_BLOCK_SIZE=0x20;
const ID_BLOCK_SERIAL_SIZE=0x18;
const ID_BLOCK_DEVICE_ID=0x19;
const ID_BLOCK_BANK_SIZE=0x1a;
const ID_BLOCK_CHECKSUM1=0x1c;
const ID_BLOCK_CHECKSUM2=0x1e;
const ID_BLOCK_CHECKSUM_BASE=0xfff2;

const OFFSET_FAT=PAGE_SIZE * 1;
const OFFSET_FAT_BACKUP=PAGE_SIZE * 2;
const FAT_RESERVED=0;
const FAT_LAST_PAGE=1;
const FAT_FREE=3;

const OFFSET_NOTE_TABLE=PAGE_SIZE * 3;
const NOTE_ENTRY_SIZE=0x20;
const NOTE_ENTRY_GAME_CODE=0x00;
const NOTE_ENTRY_PUBLISHER_CODE=0x04;
const NOTE_ENTRY_START_PAGE=0x06;
const NOTE_ENTRY_STATUS=0x08;
const NOTE_ENTRY_EXTENSION=0x0c;
const NOTE_ENTRY_NAME=0x10;
const NOTE_STATUS_FLAG=0x02;
const NOTE_NAME_SIZE=16;
const NOTE_EXTENSION_SIZE=4;

const CONTROLLER_PAK_SIZE=PAGE_SIZE * PAGE_COUNT;
const DEXDRIVE_MAGIC='123-456-STD';
const DEXDRIVE_HEADER_SIZE=0x1040;
const MUPEN64_SAVEGAME_SIZE=296960;
const MUPEN64_MPK_OFFSET=0x800; //first controller pak after the normal EEPROM save

/* note name characters, starting at 0x10 */
const NOTE_CHARS=
	'0123456789ABCDEF' +
	'GHIJKLMNOPQRSTUV' +
	'WXYZ!"#\'*+,-./:=' +
	'?@\u3002\u309b\u309c\u30a1\u30a3\u30a5\u30a7\u30a9\u30c3\u30e3\u30e5\u30e7\u30f2\u30f3' +
	'\u30a2\u30a4\u30a6\u30a8\u30aa\u30ab\u30ad\u30af\u30b1\u30b3\u30b5\u30b7\u30b9\u30bb\u30bd\u30bf' +
	'\u30c1\u30c4\u30c6\u30c8\u30ca\u30cb\u30cc\u30cd\u30ce\u30cf\u30d2\u30d5\u30d8\u30db\u30de\u30df' +
	'\u30e0\u30e1\u30e2\u30e4\u30e6\u30e8\u30e9\u30ea\u30eb\u30ec\u30ed\u30ef\u30ac\u30ae\u30b0\u30b2' +
	'\u30b4\u30b6\u30b8\u30ba\u30bc\u30be\u30c0\u30c2\u30c5\u30c7\u30c9\u30d0\u30d3\u30d6\u30d9\u30dc' +
	'\u30d1\u30d4\u30d7\u30da\u30dd'
;
const NOTE_CHAR_SPACE=0x0f;

const N64_REGIONS_JPN='J';
const N64_REGIONS_USA='E';
const N64_REGIONS_EUR='DFIPSUXY';




const SYSTEM={
	id:'n64',
	slotLetters:false,
	validExtensions:'.mpk,.n64,.pak,.mem,.note',
	exampleFile:'example.mpk',
	defaultIconFile:'slot.png',
	infoFields:[
		'sizeText'
	],
	editableFields:[
		'fileName',
		'extension',
		'gameCode',
		'publisherCode'
	]
}









function MemoryCard(arrayBuffer, name){
	this.unsavedChanges=false;
	this.size=USABLE_PAGES;
	this._rawData=new BinaryReader(arrayBuffer? arrayBuffer : RAW_SIZE, typeof name==='string'? name : 'controller_pak.mpk');

	this.content=[];

	this.idBlock=new Uint8Array(ID_BLOCK_SIZE);
	if(arrayBuffer){
		//use the first ID block copy that is intact
		var offset=ID_BLOCK_OFFSETS[0];
		for(var i=0; i<ID_BLOCK_OFFSETS.length; i++){
			if(isIdBlockValid(this._rawData._u8array, ID_BLOCK_OFFSETS[i])){
				offset=ID_BLOCK_OFFSETS[i];
				break;
			}
		}
		this.idBlock.set(this._rawData._u8array.subarray(offset, offset + ID_BLOCK_SIZE));
	}else{
		for(var i=0; i<ID_BLOCK_SERIAL_SIZE; i++)
			this.idBlock[i]=Math.floor(Math.random() * 256);
		this.idBlock[ID_BLOCK_DEVICE_ID]=0x01;
		this.idBlock[ID_BLOCK_BANK_SIZE]=0x01;
	}

	this.buildRawData();
}
MemoryCard.fromArrayBuffer=function(arrayBuffer, name){
	var u8=new Uint8Array(arrayBuffer);

	if(u8.length===MUPEN64_SAVEGAME_SIZE && /\.srm$/.test(name)){
		u8=u8.subarray(MUPEN64_MPK_OFFSET, MUPEN64_MPK_OFFSET + RAW_SIZE);
		if(typeof name==='string')
			name=name.replace(/\.srm$/i, '.mpk');
	}else if(u8.length===CONTROLLER_PAK_SIZE + DEXDRIVE_HEADER_SIZE && readAscii(u8, 0, DEXDRIVE_MAGIC.length)===DEXDRIVE_MAGIC){
		u8=u8.subarray(DEXDRIVE_HEADER_SIZE);
		if(typeof name==='string')
			name=name.replace(/\.n64$/i, '.mpk');
	}else if(u8.length!==RAW_SIZE && u8.length!==CONTROLLER_PAK_SIZE){
		return null;
	}

	var valid=false;
	for(var i=0; i<ID_BLOCK_OFFSETS.length; i++)
		valid=valid || isIdBlockValid(u8, ID_BLOCK_OFFSETS[i]);
	if(!valid)
		return null;

	var memoryCard=new MemoryCard(u8.slice().buffer, name);

	//the FAT is stored twice, use the first copy that is intact
	var fatOffset=OFFSET_FAT;
	if(!isFatValid(u8, OFFSET_FAT) && isFatValid(u8, OFFSET_FAT_BACKUP))
		fatOffset=OFFSET_FAT_BACKUP;

	memoryCard.content=[];
	for(var i=0; i<MAX_NOTES; i++){
		var entryOffset=OFFSET_NOTE_TABLE + i * NOTE_ENTRY_SIZE;
		var page=readU16(u8, entryOffset + NOTE_ENTRY_START_PAGE);
		if(page<FIRST_NOTE_PAGE || page>=PAGE_COUNT)
			continue;

		//follow the page chain
		var pages=[];
		var validChain=true;
		while(true){
			if(page<FIRST_NOTE_PAGE || page>=PAGE_COUNT || pages.indexOf(page)!==-1){
				validChain=false;
				break;
			}
			pages.push(page);
			var next=readU16(u8, fatOffset + page * 2);
			if(next===FAT_LAST_PAGE)
				break;
			page=next;
		}
		if(!validChain)
			continue;

		var noteFile=new BinaryReader(NOTE_ENTRY_SIZE + pages.length * PAGE_SIZE);
		noteFile._u8array.set(u8.subarray(entryOffset, entryOffset + NOTE_ENTRY_SIZE), 0);
		for(var j=0; j<pages.length; j++)
			noteFile._u8array.set(u8.subarray(pages[j] * PAGE_SIZE, (pages[j] + 1) * PAGE_SIZE), NOTE_ENTRY_SIZE + j * PAGE_SIZE);

		var newContent=new Content(noteFile._u8array.buffer);
		newContent._rawData.name=newContent.gameCode+'_'+newContent.fileName+'.note';
		memoryCard.content.push(newContent);
	}
	return memoryCard;
}
MemoryCard.prototype.buildRawData=function(){
	var raw=this._rawData._u8array;

	//ID sector: the intact ID block is copied over the four slots and its checksums are recalculated
	for(var i=0; i<ID_BLOCK_OFFSETS.length; i++){
		raw.set(this.idBlock, ID_BLOCK_OFFSETS[i]);
		var checksums=calculateIdChecksums(raw, ID_BLOCK_OFFSETS[i]);
		writeU16(raw, ID_BLOCK_OFFSETS[i] + ID_BLOCK_CHECKSUM1, checksums[0]);
		writeU16(raw, ID_BLOCK_OFFSETS[i] + ID_BLOCK_CHECKSUM2, checksums[1]);
	}

	//notes are stored contiguously from page 5
	var fat=new Array(PAGE_COUNT);
	for(var i=0; i<PAGE_COUNT; i++)
		fat[i]=(i<FIRST_NOTE_PAGE)? FAT_RESERVED : FAT_FREE;

	raw.fill(0x00, OFFSET_NOTE_TABLE, OFFSET_NOTE_TABLE + PAGE_SIZE * 2);
	var nextPage=FIRST_NOTE_PAGE;
	for(var i=0; i<this.content.length; i++){
		var content=this.content[i];
		content.startPage=nextPage;
		content.buildRawData();

		raw.set(content._rawData._u8array.subarray(0, NOTE_ENTRY_SIZE), OFFSET_NOTE_TABLE + i * NOTE_ENTRY_SIZE);
		raw.set(content._rawData._u8array.subarray(NOTE_ENTRY_SIZE, NOTE_ENTRY_SIZE + content.size * PAGE_SIZE), nextPage * PAGE_SIZE);
		for(var j=0; j<content.size; j++)
			fat[nextPage + j]=(j===content.size - 1)? FAT_LAST_PAGE : nextPage + j + 1;
		nextPage+=content.size;
	}
	raw.fill(0x00, nextPage * PAGE_SIZE);

	//FAT and its identical backup, each with its own checksum
	raw.fill(0x00, OFFSET_FAT, OFFSET_FAT + PAGE_SIZE);
	for(var i=1; i<PAGE_COUNT; i++)
		writeU16(raw, OFFSET_FAT + i * 2, fat[i]);
	raw[OFFSET_FAT + 1]=calculateFatChecksum(raw, OFFSET_FAT);
	raw.set(raw.subarray(OFFSET_FAT, OFFSET_FAT + PAGE_SIZE), OFFSET_FAT_BACKUP);

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

	var rawFile=this._rawData.slice();
	rawFile.name=this._rawData.name;
	return rawFile;
}

MemoryCard.prototype.importContent=function(content){
	//a note with the same game, name and extension is replaced
	var contents=this.content.slice();
	var existingIndex=-1;
	for(var i=0; i<contents.length; i++){
		if(contents[i].isSameNote(content)){
			existingIndex=i;
			break;
		}
	}
	if(existingIndex!==-1)
		contents[existingIndex]=content;
	else if(contents.length<MAX_NOTES)
		contents.push(content);
	else
		return false;

	var usedPages=0;
	for(var i=0; i<contents.length; i++)
		usedPages+=contents[i].size;
	if(usedPages>this.size)
		return false;

	this.content=contents;
	return true;
}

MemoryCard.prototype.format=function(){
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
	Content._rawData is a 32-byte note table entry followed by the pages of the note.
	It is also the format of exported .note files.
*/
function Content(arrayBuffer){
	this._rawData=new BinaryReader(arrayBuffer);
	this.size=(this._rawData.size - NOTE_ENTRY_SIZE) / PAGE_SIZE;

	/* parse data */
	var raw=this._rawData._u8array;
	this.gameCode=readCode(raw, NOTE_ENTRY_GAME_CODE, 4);
	this.publisherCode=readCode(raw, NOTE_ENTRY_PUBLISHER_CODE, 2);
	this.startPage=readU16(raw, NOTE_ENTRY_START_PAGE);
	this.fileName=readNoteText(raw, NOTE_ENTRY_NAME, NOTE_NAME_SIZE);
	this.extension=readNoteText(raw, NOTE_ENTRY_EXTENSION, NOTE_EXTENSION_SIZE);

	this.sizeText=this.size+' pages ('+(this.size * PAGE_SIZE)+' bytes)';

	this.icon=new ContentIcon(SYSTEM.defaultIconImageData? [SYSTEM.defaultIconImageData] : []);
}
Content.fromArrayBuffer=function(arrayBuffer){
	var file=new BinaryReader(arrayBuffer);

	if(
		file.size<NOTE_ENTRY_SIZE + PAGE_SIZE || (file.size - NOTE_ENTRY_SIZE) % PAGE_SIZE!==0 ||
		(file.size - NOTE_ENTRY_SIZE) / PAGE_SIZE>USABLE_PAGES ||
		!(file.readU8At(NOTE_ENTRY_STATUS) & NOTE_STATUS_FLAG)
	)
		return null;

	return new Content(arrayBuffer);
}

Content.prototype.export=function(){
	this.buildRawData();

	return this._rawData.slice();
}
Content.prototype.buildRawData=function(){
	writeU16(this._rawData._u8array, NOTE_ENTRY_START_PAGE, this.startPage);

	this._rawData.name=(this.gameCode+'_'+this.fileName).replace(/[\\\/:*?"<>|]/g, '_').replace(/\s+/g, ' ')+'.note';
	return this._rawData._u8array.buffer;
}
Content.prototype.isSameNote=function(content){
	return this.gameCode===content.gameCode && this.publisherCode===content.publisherCode && this.fileName===content.fileName && this.extension===content.extension;
}
Content.prototype.info=function(){
	var regionCode=this.gameCode.charAt(3);
	var region;
	if(regionCode===N64_REGIONS_JPN)
		region=REGION_JPN;
	else if(regionCode===N64_REGIONS_USA)
		region=REGION_USA;
	else if(regionCode && N64_REGIONS_EUR.indexOf(regionCode)!==-1)
		region=REGION_EUR;
	else
		region=REGION_UNKNOWN;

	var summary=UI.monoText(UI.escapeHTML(this.gameCode + this.publisherCode)) + ' ' + UI.getFlagIcon(region) + ' ';
	summary+=UI.getBlocksString(this.size);

	return {
		region:region,
		gameCode:this.gameCode,
		blocks:this.size,
		name:UI.escapeHTML(this.fileName + (this.extension? '.'+this.extension : '') || '-'),
		summary:summary
	};
}

Content.prototype.setFileName=function(fileName){
	if(typeof fileName !== 'string')
		return false;

	writeNoteText(this._rawData._u8array, NOTE_ENTRY_NAME, NOTE_NAME_SIZE, fileName);
	this.fileName=readNoteText(this._rawData._u8array, NOTE_ENTRY_NAME, NOTE_NAME_SIZE);
}
Content.prototype.setExtension=function(extension){
	if(typeof extension !== 'string')
		return false;

	writeNoteText(this._rawData._u8array, NOTE_ENTRY_EXTENSION, NOTE_EXTENSION_SIZE, extension);
	this.extension=readNoteText(this._rawData._u8array, NOTE_ENTRY_EXTENSION, NOTE_EXTENSION_SIZE);
}
Content.prototype.setGameCode=function(gameCode){
	if(typeof gameCode !== 'string')
		return false;

	this.gameCode=gameCode.trim().toUpperCase().replace(/[^A-Z0-9]/g, '').substr(0, 4);
	this._rawData.writeStringAt(NOTE_ENTRY_GAME_CODE, this.gameCode, 4);
}
Content.prototype.setPublisherCode=function(publisherCode){
	if(typeof publisherCode !== 'string')
		return false;

	this.publisherCode=publisherCode.trim().toUpperCase().replace(/[^A-Z0-9]/g, '').substr(0, 2);
	this._rawData.writeStringAt(NOTE_ENTRY_PUBLISHER_CODE, this.publisherCode, 2);
}



/* helper functions */
function readAscii(u8array, offset, len){
	var str='';
	for(var i=0; i<len && u8array[offset + i]!==0x00; i++){
		var c=u8array[offset + i];
		str+=(c>=0x20 && c<0x7f)? String.fromCharCode(c) : '?';
	}
	return str;
}
function readCode(u8array, offset, len){
	var str='';
	for(var i=0; i<len; i++){
		var c=u8array[offset + i];
		if(c<0x20 || c>=0x7f){ //not text, e.g. Wave Race 64 uses a publisher code of 0x0001
			str='';
			for(i=0; i<len; i++)
				str+=u8array[offset + i].toString(16).toUpperCase().padStart(2, '0');
			return str;
		}
		str+=String.fromCharCode(c);
	}
	return str;
}
function readNoteText(u8array, offset, len){
	var str='';
	for(var i=0; i<len && u8array[offset + i]!==0x00; i++){
		var c=u8array[offset + i];
		if(c===NOTE_CHAR_SPACE)
			str+=' ';
		else if(c>=0x10 && c<0x10 + NOTE_CHARS.length)
			str+=NOTE_CHARS.charAt(c - 0x10);
		else
			str+='?';
	}
	return str.replace(/ +$/, '');
}
function writeNoteText(u8array, offset, len, str){
	str=str.toUpperCase();
	for(var i=0; i<len; i++){
		var code=0x00;
		if(i<str.length){
			var index=NOTE_CHARS.indexOf(str.charAt(i));
			code=index!==-1? 0x10 + index : NOTE_CHAR_SPACE;
		}
		u8array[offset + i]=code;
	}
}
function readU16(u8array, offset){
	return (u8array[offset] << 8) | u8array[offset + 1];
}
function writeU16(u8array, offset, value){
	u8array[offset]=value >> 8;
	u8array[offset + 1]=value & 0xff;
}
function calculateIdChecksums(u8array, offset){
	var checksum=0;
	for(var i=0; i<ID_BLOCK_CHECKSUM1; i+=2)
		checksum=(checksum + readU16(u8array, offset + i)) & 0xffff;
	return [checksum, (ID_BLOCK_CHECKSUM_BASE - checksum) & 0xffff];
}
function isIdBlockValid(u8array, offset){
	//the inverted checksum is not checked, some tools write it differently and games repair it anyway
	return readU16(u8array, offset + ID_BLOCK_CHECKSUM1)===calculateIdChecksums(u8array, offset)[0] && !!(u8array[offset + ID_BLOCK_DEVICE_ID] & 0x01);
}
function calculateFatChecksum(u8array, offset){
	//entries of the reserved pages are not part of the checksum
	var checksum=0;
	for(var i=FIRST_NOTE_PAGE * 2; i<PAGE_SIZE; i++)
		checksum=(checksum + u8array[offset + i]) & 0xff;
	return checksum;
}
function isFatValid(u8array, offset){
	return u8array[offset + 1]===calculateFatChecksum(u8array, offset);
}