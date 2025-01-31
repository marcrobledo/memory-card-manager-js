/*
* Memory Card Manager JS
* Console memory card manager interface made in vanilla JS.
* By Marc Robledo https://www.marcrobledo.com
* Sourcecode: https://github.com/marcrobledo/memory-card-manager-js/
* License:
*
* MIT License
* 
* Copyright (c) 2019-2025 Marc Robledo
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


const REGION_UNKNOWN=0;
const REGION_JPN=1;
const REGION_USA=2;
const REGION_EUR=3;

var userLanguage;


var memoryCards=[];
var currentMemoryCard, currentContent;
var dropdownMemorycard, dropdownContent;
var templateContent;
var firstImport=true;


var UI=(function(){
	return {
		getBlocksString(blocks){
			return blocks>1? _('%s blocks').replace('%s', blocks) : _('1 block');
		},
		getFreeBlocksString(freeBlocks){
			return _(freeBlocks===1? '1 free block' : '%s free blocks').replace('%s', freeBlocks)
		},
		getFlagIcon:function(region){
			if(region===REGION_JPN)
				return '<img src="../core/assets/flag_jpn.png" />';
			else if(region===REGION_USA)
				return '<img src="../core/assets/flag_usa.png" />';
			else if(region===REGION_EUR)
				return '<img src="../core/assets/flag_eur.png" />';
			return '';
		},
		formatDate:function(milliseconds){
			var d=new Date();
			d.setTime(milliseconds);

			var yyyy=d.getFullYear();
			var mm=(d.getMonth()+1).toString().padStart(2, '0');
			var dd=d.getDate().toString().padStart(2, '0');
			var hh=d.getHours().toString().padStart(2, '0');
			var ii=d.getMinutes().toString().padStart(2, '0');

			return yyyy+'-'+mm+'-'+dd+' '+hh+':'+ii;
		},
		monoText:function(str){
			return '<span class="mono">'+str+'</span>';
		},
		getSlotId:function(index){
			return String.fromCharCode((SYSTEM.slotLetters? 'A' : '1').charCodeAt(0) + index);
		}
	}
}())






function ContentIcon(imageDatas){
	this.canvas=document.createElement('canvas');
	this.ctx=this.canvas.getContext('2d');
	if(imageDatas && imageDatas.length){
		this.canvas.width=imageDatas[0].width;
		this.canvas.height=imageDatas[0].height;
		this.imageDatas=imageDatas;
		this.ctx.putImageData(imageDatas[0], 0, 0);
		
	}else{
		this.canvas.width=16;
		this.canvas.height=16;
		this.imageDatas=[];
	}
	this.speed=15;
	this.count=0;
	this.frame=0;
}
ContentIcon.prototype.animate=function(){
	if(this.imageDatas.length>1){
		this.count++;
		if(this.count===this.speed){
			this.frame++;
			if(this.frame===this.imageDatas.length)
				this.frame=0;
			this.ctx.putImageData(this.imageDatas[this.frame], 0, 0);
			this.count=0;
		}
	}
}
function animateIconsLoop(){
	for(var i=0; i<memoryCards.length; i++){
		if(memoryCards[i].content.length){
			for(var j=0; j<memoryCards[i].content.length; j++){
				if(memoryCards[i].content[j].icon)
					memoryCards[i].content[j].icon.animate();
			}
		}
	}
	window.requestAnimationFrame(animateIconsLoop);
}



function _parseInputFile(file){
	var fr=new FileReader();
	fr.addEventListener('load',function(){
		var imported=false;
		var memoryCardTemp=MemoryCard.fromArrayBuffer(this.result, this.fileName);
		if(memoryCardTemp){
			var currentMemoryCardIndex=memoryCards.indexOf(currentMemoryCard);
			if(currentMemoryCardIndex!==-1){
				memoryCards[currentMemoryCardIndex]=currentMemoryCard=memoryCardTemp;

				refreshHtml(currentMemoryCardIndex);
				
				if(currentMemoryCard.content.length)
					imported=true;
			}
		}else{
			var content=Content.fromArrayBuffer(this.result);
			if(content){
				if(currentMemoryCard.importContent(content)){
					refreshHtml(currentMemoryCard);
					imported=true;
				}
			}
		}
		
		if(imported && firstImport){
			newMemoryCard();
			$('.memcard.disabled').remove();
			firstImport=false;
		}
	});
	fr.fileName=file.name;
	fr.readAsArrayBuffer(file);
}


function newMemoryCard(){
	var memoryCard=new MemoryCard();
	memoryCards.push(memoryCard);
	buildHtml(memoryCards.indexOf(memoryCard));
}



function buildHtml(memoryCardIndex){

	var htmlElement=$('#template-memcard').clone().removeClass('hide').prop('id','memcard-'+memoryCardIndex).appendTo('#memcards');

	htmlElement.on('drop', function(evt){
		evt.preventDefault();
		$(this).removeClass('dragdrop');

		currentMemoryCard=memoryCards[memoryCardIndex];

		if(evt.dataTransfer && evt.dataTransfer.items && evt.dataTransfer.items.length){
			var droppedFile=evt.dataTransfer.items[0].getAsFile();
			if(droppedFile)
				_parseInputFile(droppedFile);
		}
	});
	$(htmlElement).on('dragenter', function(evt){
		$(this).addClass('dragdrop');
	});
	$(htmlElement).on('dragexit', function(evt){
		$(this).removeClass('dragdrop');
	});
	$(document.body).on('dragover', function(evt){
		evt.preventDefault();
	});

	htmlElement.find('.btn-save').on('click', function(evt){
		currentMemoryCard=memoryCards[memoryCardIndex];
		currentMemoryCard.export().save();
	});
	htmlElement.find('.btn-more').on('click', function(evt){
		evt.stopPropagation();
		currentMemoryCard=memoryCards[memoryCardIndex];
		$('.btn.expanded').removeClass('expanded');
		$(this).addClass('expanded');
		$('.dropdown').addClass('hide');
		$('#dropdown-memcard').removeClass('hide').appendTo(this.parentElement);
	});
	/*htmlElement.find('.dropdown').on('click', function(evt){
		evt.stopPropagation();
	});*/

	htmlElement.find('.memcard-slot').html(UI.getSlotId(memoryCardIndex));
	
	refreshHtml(memoryCardIndex);
	
	return htmlElement.get(0);
}
function refreshHtml(memoryCardIndex){
	if(typeof memoryCardIndex==='object'){
		memoryCardIndex=memoryCards.indexOf(memoryCardIndex);
	}

	var memoryCard=memoryCards[memoryCardIndex];
	var memoryCardInfo=memoryCard.info();
	var htmlElement=$('#memcard-'+memoryCardIndex);
	htmlElement.find('.container-summary').html(memoryCardInfo.summary);
	htmlElement.find('.progress-bar').css('width', memoryCardInfo.usage+'%');
	if(memoryCardInfo.usage>=100){
		htmlElement.find('.progress-bar').addClass('full');
	}else{
		htmlElement.find('.progress-bar').removeClass('full');
	}
	
	var contentsContainer=htmlElement.find('.contents');
	contentsContainer.empty();

	for(var i=0; i<memoryCard.content.length; i++){

		var content=memoryCard.content[i];
		
		if(!content.htmlElement){
			content.htmlElement=templateContent.clone().get(0);
			$(content.htmlElement).find('.btn-more').on('click', [memoryCard, content], function(evt){
				evt.stopPropagation();
				currentMemoryCard=evt.data[0];
				currentContent=evt.data[1];
				$('.btn.expanded').removeClass('expanded');
				$(this).addClass('expanded');
				$('.content.active').removeClass('active');
				$(currentContent.htmlElement).addClass('active');
				$('.dropdown').addClass('hide');

				var index=memoryCards.indexOf(currentMemoryCard);
				if(index>0){
					$(dropdownContent).find('#btn-content-copy-slot-prev').html(UI.getSlotId(index - 1));
					$(dropdownContent).find('#btn-content-copy-prev').parent().removeClass('hide');
				}else{
					$(dropdownContent).find('#btn-content-copy-prev').parent().addClass('hide');
				}
				if(index<memoryCards.length-1){
					$(dropdownContent).find('#btn-content-copy-slot-next').html(UI.getSlotId(index + 1));
					$(dropdownContent).find('#btn-content-copy-next').parent().removeClass('hide');
				}else{
					$(dropdownContent).find('#btn-content-copy-next').parent().addClass('hide');
				}

				$(dropdownContent).removeClass('hide').appendTo(this.parentElement)
					.get(0).scrollIntoView({behavior:'smooth',block:'center'});
			});
		}
		var htmlElement=$(content.htmlElement);
		htmlElement.appendTo(contentsContainer);
		
		var contentInfo=content.info();
		htmlElement.find('.container-name').html(contentInfo.name);
		htmlElement.find('.container-summary').html(contentInfo.summary);

		if(content.icon)
			htmlElement.find('.container-icon').append(content.icon.canvas);

		if(content.deleted)
			htmlElement.addClass('text-muted');
		else
			htmlElement.removeClass('text-muted');
	}
}



























/* initialize app */
$(document).ready(function(){	
	templateContent=$('#template-content').prop('id','').removeClass('hide').remove();
	dropdownContent=document.getElementById('dropdown-content');

	newMemoryCard();

	var placeholderMemoryCard=$('<div></div>').addClass('memcard disabled').appendTo('#memcards');	
	if(SYSTEM.exampleFile){
		placeholderMemoryCard.append(
			$('<button></button>')
				.addClass('btn btn-glow')
				.html(_('Try an example file!'))
				.on('click', function(evt){
					$(this).remove();
					window.fetch(SYSTEM.exampleFile)
						.then(res => res.arrayBuffer()) // Gets the response and returns it as a blob
						.then(ab => {
							var exampleMemoryCard=MemoryCard.fromArrayBuffer(ab, SYSTEM.exampleFile);
							memoryCards[0]=currentMemoryCard=exampleMemoryCard;
							refreshHtml(0);
							
							newMemoryCard();
							$('.memcard.disabled').remove();
							firstImport=false;
						})
						.catch(function(){
							alert('Unexpected error: can\'t download example savegame');
						});
				})
		);
	}

	$('#btn-memcard-load').on('click', function(evt){
		$('#input-file').trigger('click');
	});
	$('#btn-memcard-format').on('click', function(evt){
		if(currentMemoryCard.content.length)
			document.getElementById('modal-format').showModal();
	});
	$('#btn-content-delete').on('click', function(evt){
		document.getElementById('modal-content-delete').showModal();
	});

	$('#btn-content-save').on('click', function(evt){
		currentContent.export().save();
	});
	$('#btn-content-copy-next').on('click', function(evt){
		var nextIndex=memoryCards.indexOf(currentMemoryCard) + 1;
		
		if(nextIndex<memoryCards.length){
			var clonedContent=new Content(currentContent._rawData.slice()._u8array.buffer);
			clonedContent._rawData.name=currentContent._rawData.name;
			memoryCards[nextIndex].importContent(clonedContent);
			refreshHtml(memoryCards[nextIndex]);
		}
	});
	$('#btn-content-copy-prev').on('click', function(evt){
		var prevIndex=memoryCards.indexOf(currentMemoryCard) - 1;
		
		if(prevIndex>-1){
			var clonedContent=new Content(currentContent._rawData.slice()._u8array.buffer);
			clonedContent._rawData.name=currentContent._rawData.name;
			memoryCards[prevIndex].importContent(clonedContent);
			refreshHtml(memoryCards[prevIndex]);
		}
	});
	$('#btn-content-edit').on('click', function(evt){
		for(var i=0; i<SYSTEM.infoFields.length; i++){
			var elem=$('#modal-content-'+SYSTEM.infoFields[i]);
			if(elem.prop('tagName')==='CANVAS')
				if(currentContent[SYSTEM.infoFields[i]])
					elem.get(0).getContext('2d').putImageData(currentContent[SYSTEM.infoFields[i]], 0, 0);
				else
					elem.get(0).getContext('2d').clearRect(0, 0, elem.get(0).width, elem.get(0).height);
			else
				elem.html(currentContent[SYSTEM.infoFields[i]])
		}

		$('#modal-content').find('input, select').data('changed', false);
		for(var i=0; i<SYSTEM.editableFields.length; i++){
			var elem=$('#modal-content-'+SYSTEM.editableFields[i]);
			if(elem.prop('type')==='checkbox')
				elem.prop('checked', currentContent[SYSTEM.editableFields[i]]);
			else
				elem.val(currentContent[SYSTEM.editableFields[i]]);
		}
		document.getElementById('modal-content').showModal();
	});
	$('#modal-content .btn-cancel').on('click', function(evt){
		document.getElementById('modal-content').close();
	});
	$('#modal-format .btn-cancel').on('click', function(evt){
		document.getElementById('modal-format').close();
	});
	$('#modal-content-delete .btn-cancel').on('click', function(evt){
		document.getElementById('modal-content-delete').close();
	});
	$('#modal-content .btn-primary').on('click', function(evt){
		document.getElementById('modal-content').close(1);
	});
	$('#modal-format .btn-danger').on('click', function(evt){
		currentMemoryCard.format();
		refreshHtml(currentMemoryCard);
		document.getElementById('modal-format').close(1);
	});
	$('#modal-content-delete .btn-danger').on('click', function(evt){
		if(currentMemoryCard.deleteContent(currentContent))
			refreshHtml(currentMemoryCard);
		document.getElementById('modal-content-delete').close(1);
	});
	$('#modal-content').on('close', function(evt){
		if(this.returnValue){
			var changedValues=0;
			for(var i=0; i<SYSTEM.editableFields.length; i++){
				var elem=$('#modal-content-'+SYSTEM.editableFields[i]);
				
				if(elem.data('changed')){
					var newValue;
					if(elem.prop('type')==='checkbox')
						newValue=elem.prop('checked');
					else
						newValue=elem.val();
					currentContent['set'+SYSTEM.editableFields[i].charAt(0).toUpperCase()+SYSTEM.editableFields[i].substr(1)](newValue);
					changedValues++;
				}
			}

			if(changedValues)
				refreshHtml(currentMemoryCard);
		}
	});
	$('#modal-content').find('input, select').on('change', function(evt){
		$(this).data('changed', true);
	});



	$(document.body).on('click', function(evt){
		$('.dropdown').addClass('hide');
		$('.content.active').removeClass('active');
		$('.btn.expanded').removeClass('expanded');
	});

	
	$('<input></input>')
		.attr('type', 'file')
		.attr('id','input-file')
		.attr('accept',SYSTEM.validExtensions)
		.addClass('hide')
		.on('change', function(){
			if(this.files.length){
				_parseInputFile(this.files[0]);
			}
		})
		.appendTo(document.body);

	window.requestAnimationFrame(animateIconsLoop);
});
