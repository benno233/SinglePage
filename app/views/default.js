/**
 * @author gp
 * @datetime 2013-3-27
 * @description Page1.js
 */
 
 define(function(require,exports,module){

 	var Page1 = Ambow.extend(Ambow.View,{
 		tagName:'div',
 		
 		className:'testName',
 		
 		initialize: function(){
 			
 		},
 		

 		
 		render: function(){
 			this.$el.html('页面演示');
 			Ambow.el.html(this.el);
 			return this;
 		}
 	});
 	
 	return Page1;
 	
 });