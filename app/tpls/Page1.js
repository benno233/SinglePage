/**
 * @author gp
 * @datetime 2013-3-27
 * @description Page1.js
 */
 
 define(function(require,exports,module){
 	var tpls = {
 		init_tpl:[
 			'<div><%= name %></div>',
 			'<p><input type="button" class="btn btn_gray" id="btn" value="<%= btnName %>"></p>'
 		].join('')
 	}
 	
 	return tpls;
 });