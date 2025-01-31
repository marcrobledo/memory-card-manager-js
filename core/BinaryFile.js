/* BinaryReader.js v20200212 - Marc Robledo 2014-2023 - http://www.marcrobledo.com/license */

function BinaryReader(source, name, type){
	this._lastRead=null;
	this.littleEndian=false;

	this.offset=0;
	this.name=typeof name==='string'? name : 'file.bin';
	this.type=typeof type==='string'? type : 'application/octet-stream';

	if(typeof source==='object' && typeof source.byteLength==='number'){ /* source is ArrayBuffer or TypedArray */
		this.size=source.byteLength;
		this._u8array=new Uint8Array(typeof source.buffer !== 'undefined'? source.buffer : source);

	}else if(typeof source==='number'){ /* source is integer (new blank data) */
		this.size=source;
		this._u8array=new Uint8Array(new ArrayBuffer(source));

	}else{
		throw new Error('Invalid BinaryReader source');
	}
}
BinaryReader.IS_MACHINE_LITTLE_ENDIAN=(function(){	/* https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/DataView#Endianness */
	var buffer=new ArrayBuffer(2);
	new DataView(buffer).setInt16(0, 256, true /* littleEndian */);
	// Int16Array uses the platform's endianness.
	return new Int16Array(buffer)[0] === 256;
})();



BinaryReader.prototype.seek=function(offset){
	this.offset=offset;
}
BinaryReader.prototype.skip=function(nBytes){
	this.offset+=nBytes;
}
BinaryReader.prototype.isEOF=function(){
	return !(this.offset<this.size)
}

BinaryReader.prototype.slice=function(offset, len){
	if(typeof offset!=='number' || offset<0 || offset>=this.size){
		offset=0;
	}
	len=len || (this.size-offset);

	var newFile=new BinaryReader(this._u8array.buffer.slice(offset, offset+len), this.name, this.type);

	newFile.littleEndian=this.littleEndian;
	return newFile;
}


BinaryReader.prototype.copyTo=function(target, offsetSource, len, offsetTarget){
	if(typeof offsetTarget==='undefined')
		offsetTarget=offsetSource;

	len=len || (this.size-offsetSource);

	for(var i=0; i<len; i++){
		target._u8array[offsetTarget+i]=this._u8array[offsetSource+i];
	}
}


BinaryReader.prototype.save=function(){
	saveAs(
		new Blob([this._u8array], {type:this.type}),
		this.name
	);
}

BinaryReader.prototype.getExtension=function(){
	if(typeof this.name==='string'){
		var matches=this.name.toLowerCase().match(/\.(\w+)$/);
		if(matches)
			return matches[1];
	}
	return null;
}


BinaryReader.prototype.readU8At=function(offset){
	return this._lastRead=this._u8array[offset];
}
BinaryReader.prototype.readU8=function(){
	this._lastRead=this._u8array[this.offset];

	this.offset++;
	return this._lastRead
}
BinaryReader.prototype.readU16At=function(offset){
	if(this.littleEndian)
		return _lastRead=(this._u8array[offset] + (this._u8array[offset+1] << 8))>>>0;
	else
		return _lastRead=((this._u8array[offset] << 8) + this._u8array[offset+1])>>>0;

}
BinaryReader.prototype.readU16=function(){
	if(this.littleEndian)
		this._lastRead=this._u8array[this.offset] + (this._u8array[this.offset+1] << 8);
	else
		this._lastRead=(this._u8array[this.offset] << 8) + this._u8array[this.offset+1];

	this.offset+=2;
	return this._lastRead >>> 0
}
BinaryReader.prototype.readU24=function(){
	if(this.littleEndian)
		this._lastRead=this._u8array[this.offset] + (this._u8array[this.offset+1] << 8) + (this._u8array[this.offset+2] << 16);
	else
		this._lastRead=(this._u8array[this.offset] << 16) + (this._u8array[this.offset+1] << 8) + this._u8array[this.offset+2];

	this.offset+=3;
	return this._lastRead >>> 0
}
BinaryReader.prototype.readU32=function(){
	if(this.littleEndian)
		this._lastRead=this._u8array[this.offset] + (this._u8array[this.offset+1] << 8) + (this._u8array[this.offset+2] << 16) + (this._u8array[this.offset+3] << 24);
	else
		this._lastRead=(this._u8array[this.offset] << 24) + (this._u8array[this.offset+1] << 16) + (this._u8array[this.offset+2] << 8) + this._u8array[this.offset+3];

	this.offset+=4;
	return this._lastRead >>> 0
}
BinaryReader.prototype.readU32At=function(offset){
	if(this.littleEndian)
		this._lastRead=this._u8array[offset] + (this._u8array[offset+1] << 8) + (this._u8array[offset+2] << 16) + (this._u8array[offset+3] << 24);
	else
		this._lastRead=(this._u8array[offset] << 24) + (this._u8array[offset+1] << 16) + (this._u8array[offset+2] << 8) + this._u8array[offset+3];

	return this._lastRead >>> 0
}



BinaryReader.prototype.readBytes=function(len){
	this._lastRead=new Array(len);
	for(var i=0; i<len; i++){
		this._lastRead[i]=this._u8array[this.offset+i];
	}

	this.offset+=len;
	return this._lastRead
}
BinaryReader.prototype.readBytesAt=function(offset, len){
	this._lastRead=new Array(len);
	for(var i=0; i<len; i++){
		this._lastRead[i]=this._u8array[offset+i];
	}

	return this._lastRead
}

BinaryReader.prototype.readStringAt=function(offset, len){
	this._lastRead='';
	for(var i=0;i<len && offset<this.size && this._u8array[offset]>0;i++)
		this._lastRead=this._lastRead+String.fromCharCode(this._u8array[offset++]);

	return this._lastRead
}
BinaryReader.prototype.readString=function(len){
	this.readStringAt(this.offset, len);
	this.offset+=len;
	return this._lastRead
}

BinaryReader.prototype.writeU8At=function(offset, u8){
	this._u8array[offset]=u8;

}
BinaryReader.prototype.writeU8=function(u8){
	this._u8array[this.offset++]=u8;
}

BinaryReader.prototype.writeU16At=function(offset, u16){
	if(this.littleEndian){
		this._u8array[offset]=u16 & 0xff;
		this._u8array[offset+1]=u16 >> 8;
	}else{
		this._u8array[offset]=u16 >> 8;
		this._u8array[offset+1]=u16 & 0xff;
	}
}
BinaryReader.prototype.writeU16=function(u16){
	this.writeU16At(this.offset, u16);

	this.offset+=2;
}

BinaryReader.prototype.writeU24At=function(offset, u24){
	if(this.littleEndian){
		this._u8array[offset]=u24 & 0x0000ff;
		this._u8array[offset+1]=(u24 & 0x00ff00) >> 8;
		this._u8array[offset+2]=(u24 & 0xff0000) >> 16;
	}else{
		this._u8array[offset]=(u24 & 0xff0000) >> 16;
		this._u8array[offset+1]=(u24 & 0x00ff00) >> 8;
		this._u8array[offset+2]=u24 & 0x0000ff;
	}
}
BinaryReader.prototype.writeU24=function(u24){
	this.writeU24At(this.offset, u24);

	this.offset+=3;
}

BinaryReader.prototype.writeU32At=function(offset, u32){
	if(this.littleEndian){
		this._u8array[offset]=u32 & 0x000000ff;
		this._u8array[offset+1]=(u32 & 0x0000ff00) >> 8;
		this._u8array[offset+2]=(u32 & 0x00ff0000) >> 16;
		this._u8array[offset+3]=(u32 & 0xff000000) >> 24;
	}else{
		this._u8array[offset]=(u32 & 0xff000000) >> 24;
		this._u8array[offset+1]=(u32 & 0x00ff0000) >> 16;
		this._u8array[offset+2]=(u32 & 0x0000ff00) >> 8;
		this._u8array[offset+3]=u32 & 0x000000ff;
	}
}
BinaryReader.prototype.writeU32=function(u32){
	this.writeU32At(this.offset, u32);

	this.offset+=4;
}

BinaryReader.prototype.writeBytesAt=function(offset, a){
	for(var i=0;i<a.length;i++)
		this._u8array[offset++]=a[i]
}
BinaryReader.prototype.writeBytes=function(a){
	this.writeBytesAt(this.offset, a);

	this.offset+=a.length;
}

BinaryReader.prototype.writeStringAt=function(offset, str, len){
	len=len || str.length;
	for(var i=0; i<str.length && i<len; i++)
		this._u8array[offset++]=str.charCodeAt(i);

	for(;i<len;i++)
		this._u8array[offset++]=0x00;
}
BinaryReader.prototype.writeString=function(str, len){
	len=len || str.length;
	this.writeStringAt(this.offset, str, len);

	this.offset+=len;
}

BinaryReader.prototype.fill=function(len,u8){
	u8=(u8 & 0xff) || 0x00;
	for(var i=0; i<len; i++){
		this._u8array[this.offset]=u8;
		this.offset++;
	}
}





/*
* FileSaver.js 2.0.4
* A saveAs() FileSaver implementation.
*
* By Eli Grey, http://eligrey.com
*
* License : https://github.com/eligrey/FileSaver.js/blob/master/LICENSE.md (MIT)
* source  : http://purl.eligrey.com/github/FileSaver.js
*/
var _global="object"==typeof window&&window.window===window?window:"object"==typeof self&&self.self===self?self:"object"==typeof global&&global.global===global?global:this;function bom(a,b){return"undefined"==typeof b?b={autoBom:!1}:"object"!=typeof b&&(console.warn("Deprecated: Expected third argument to be a object"),b={autoBom:!b}),b.autoBom&&/^\s*(?:text\/\S*|application\/xml|\S*\/\S*\+xml)\s*;.*charset\s*=\s*utf-8/i.test(a.type)?new Blob([String.fromCharCode(65279),a],{type:a.type}):a}function download(a,b,c){var d=new XMLHttpRequest;d.open("GET",a),d.responseType="blob",d.onload=function(){saveAs(d.response,b,c)},d.onerror=function(){console.error("could not download file")},d.send()}function corsEnabled(a){var b=new XMLHttpRequest;b.open("HEAD",a,!1);try{b.send()}catch(a){}return 200<=b.status&&299>=b.status}function click(a){try{a.dispatchEvent(new MouseEvent("click"))}catch(c){var b=document.createEvent("MouseEvents");b.initMouseEvent("click",!0,!0,window,0,0,0,80,20,!1,!1,!1,!1,0,null),a.dispatchEvent(b)}}var isMacOSWebView=/Macintosh/.test(navigator.userAgent)&&/AppleWebKit/.test(navigator.userAgent)&&!/Safari/.test(navigator.userAgent),saveAs=_global.saveAs||("object"!=typeof window||window!==_global?function(){}:"download"in HTMLAnchorElement.prototype&&!isMacOSWebView?function(b,c,d){var e=_global.URL||_global.webkitURL,f=document.createElement("a");c=c||b.name||"download",f.download=c,f.rel="noopener","string"==typeof b?(f.href=b,f.origin===location.origin?click(f):corsEnabled(f.href)?download(b,c,d):click(f,f.target="_blank")):(f.href=e.createObjectURL(b),setTimeout(function(){e.revokeObjectURL(f.href)},4E4),setTimeout(function(){click(f)},0))}:"msSaveOrOpenBlob"in navigator?function(b,c,d){if(c=c||b.name||"download","string"!=typeof b)navigator.msSaveOrOpenBlob(bom(b,d),c);else if(corsEnabled(b))download(b,c,d);else{var e=document.createElement("a");e.href=b,e.target="_blank",setTimeout(function(){click(e)})}}:function(a,b,c,d){if(d=d||open("","_blank"),d&&(d.document.title=d.document.body.innerText="downloading..."),"string"==typeof a)return download(a,b,c);var e="application/octet-stream"===a.type,f=/constructor/i.test(_global.HTMLElement)||_global.safari,g=/CriOS\/[\d]+/.test(navigator.userAgent);if((g||e&&f||isMacOSWebView)&&"undefined"!=typeof FileReader){var h=new FileReader;h.onloadend=function(){var a=h.result;a=g?a:a.replace(/^data:[^;]*;/,"data:attachment/file;"),d?d.location.href=a:location=a,d=null},h.readAsDataURL(a)}else{var i=_global.URL||_global.webkitURL,j=i.createObjectURL(a);d?d.location=j:location.href=j,d=null,setTimeout(function(){i.revokeObjectURL(j)},4E4)}});_global.saveAs=saveAs.saveAs=saveAs,"undefined"!=typeof module&&(module.exports=saveAs);
