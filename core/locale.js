const LOCALES=['en','es'];
const LOCALIZATION={
	/* spanish */
	'es':{
		'1 block':				'1 bloque',
		'%s blocks':			'%s bloques',
		'1 free block':			'1 bloque libre',
		'%s free blocks':		'%s bloques libres',
		'Slot':					'Ranura',
		'Save':					'Guardar',
		'Load':					'Cargar',
		'Edit':					'Editar',
		'Region':				'Región',
		'Deleted':				'Eliminado',
		'Format':				'Formatear',
		'Copy to slot':			'Copiar a ranura',
		'Delete':				'Eliminar',
		'Restore':				'Restaurar',
		'Cancel':				'Cancelar',
		'Format memory card?':	'¿Formatear tarjeta de memoria?',
		'Delete content?':		'¿Eliminar contenido?',
		'Donate':				'Donar',
		'Try an example file!':	'¡Prueba un archivo de ejemplo!'
	}
};




/* Unnamed simple UI localization in JS - Marc Robledo 2019-2023 - http://www.marcrobledo.com/license */
var L10n=(function(){
	var _setLanguage=function(language){
		return LOCALIZATION[language.toLowerCase().substr(0,2)] || LOCALIZATION[LOCALES[0]];
	}

	var _currentLanguage=LOCALES[0];
	if(typeof navigator.languages==='object' && navigator.languages.length)
		_currentLanguage=navigator.languages[0];
	else if(typeof navigator.language==='string')
		_currentLanguage=navigator.language;
	else if(typeof navigator.userLanguage==='string')
		_currentLanguage=navigator.userLanguage;
	var _currentLocale=_setLanguage(_currentLanguage);


	var _translateElements=function(container){
		if(!container)
			container=document.body;

		var translatableElements=container.querySelectorAll('*[data-localize]');
		for(var i=0; i<translatableElements.length; i++){
			translatableElements[i].innerHTML=_(translatableElements[i].dataset.localize);
		}
	}

	window.addEventListener('load', function(){
		_translateElements(document.body);
	});

	return{
		_:function(str){
			return _currentLocale && _currentLocale[str] || str
		},
		setLanguage:function(langCode){
			_currentLanguage=langCode;
			_currentLocale=_setLanguage(langCode);
			_translateElements(document.body);
		},
		getLanguage:function(){
			return _currentLanguage;
		},
		nextLanguage:function(){
			var i=LOCALES.indexOf(_currentLanguage);
			i++;
			if(i===LOCALES.length)
				i=0;
			this.setLanguage(LOCALES[i]);
		},
		getLanguageCode:function(){
			return _currentLanguage
		},
		translateElements:_translateElements
	}
}());
function _(str){return L10n._(str)}