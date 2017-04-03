/*
	Terminal Kit
	
	Copyright (c) 2009 - 2017 Cédric Ronvel
	
	The MIT License (MIT)
	
	Permission is hereby granted, free of charge, to any person obtaining a copy
	of this software and associated documentation files (the "Software"), to deal
	in the Software without restriction, including without limitation the rights
	to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
	copies of the Software, and to permit persons to whom the Software is
	furnished to do so, subject to the following conditions:
	
	The above copyright notice and this permission notice shall be included in all
	copies or substantial portions of the Software.
	
	THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
	IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
	FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
	AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
	LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
	OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
	SOFTWARE.
*/

"use strict" ;



// Load modules
//var tree = require( 'tree-kit' ) ;
//var async = require( 'async-kit' ) ;

//var events = require( 'events' ) ;
var NextGenEvents = require( 'nextgen-events' ) ;
var fs = require( 'fs' ) ;
var string = require( 'string-kit' ) ;
var punycode = require( 'punycode' ) ;



function ScreenBuffer24Bits() { throw new Error( 'Cannot create ScreenBuffer24Bits object directly.' ) ; }
module.exports = ScreenBuffer24Bits ;



var termkit = require( './termkit.js' ) ;



ScreenBuffer24Bits.prototype = Object.create( termkit.ScreenBuffer.prototype ) ;
ScreenBuffer24Bits.prototype.constructor = ScreenBuffer24Bits ;



/*
	options:
		* width: buffer width (default to dst.width)
		* height: buffer height (default to dst.height)
		* dst: writting destination
		* x: default position in the dst
		* y: default position in the dst
		* wrap: default wrapping behavior of .put()
		* noFill: do not call .fill() with default values at ScreenBuffer creation
*/
ScreenBuffer24Bits.create = function create( options )
{
	// Manage options
	if ( ! options ) { options = {} ; }
	
	var self = Object.create( ScreenBuffer24Bits.prototype , {
		// a terminal or another screenBuffer
		dst: { value: options.dst , writable: true , enumerable: true } ,
		width: { enumerable: true , configurable: true ,
			value: Math.floor( options.width ) || ( options.dst ? options.dst.width : 1 )
		} ,
		height: { enumerable: true , configurable: true ,
			value: Math.floor( options.height ) || ( options.dst ? options.dst.height : 1 )
		} ,
		x: { writable: true , enumerable: true , value:
			options.x !== undefined ? options.x : ( options.dst && options.dst instanceof termkit.Terminal ? 1 : 0 )
		} ,
		y: { writable: true , enumerable: true , value:
			options.y !== undefined ? options.y : ( options.dst && options.dst instanceof termkit.Terminal ? 1 : 0 )
		} ,
		cx: { value: 0 , writable: true , enumerable: true } ,
		cy: { value: 0 , writable: true , enumerable: true } ,
		
		// Remove?
		wrap: { value: !! options.wrap , writable: true , enumerable: true }
	} ) ;
	
	Object.defineProperties( self , {
		buffer: { enumerable: true , configurable: true ,
			value: Buffer.allocUnsafe( self.width * self.height * self.ITEM_SIZE ) 
		}
	} ) ;
	
	if ( ! options.noFill ) { self.fill() ; }
	
	return self ;
} ;



/*
	options:
		* attr: attributes passed to .put()
		* transparencyChar: a char that is transparent
		* transparencyType: bit flags for the transparency char
*/
ScreenBuffer24Bits.createFromString = function createFromString( options , data )
{
	var x , y , len , attr , attrTrans , width , height , self ;
	
	// Manage options
	if ( ! options ) { options = {} ; }
	
	if ( typeof data !== 'string' )
	{
		if ( ! data.toString ) { throw new Error( '[terminal] ScreenBuffer24Bits.createFromDataString(): argument #1 should be a string or provide a .toString() method.' ) ; }
		data = data.toString() ;
	}
	
	// Transform the data into an array of lines
	data = termkit.stripControlChars( data , true ).split( '\n' ) ;
	
	// Compute the buffer size
	width = 0 ;
	height = data.length ;
	attr = ScreenBuffer24Bits.object2attr( options.attr ) ;
	
	attrTrans = attr ;
	
	if ( options.transparencyChar )
	{
		if ( ! options.transparencyType ) { attrTrans |= ScreenBuffer24Bits.prototype.TRANSPARENCY ; }
		else { attrTrans |= options.transparencyType & ScreenBuffer24Bits.prototype.TRANSPARENCY ; }
	}
	
	// Compute the width of the screenBuffer
	for ( y = 0 ; y < data.length ; y ++ )
	{
		if ( data[ y ].length > width ) { width = data[ y ].length ; }
	}
	
	// Create the buffer with the right width & height
	self = ScreenBuffer24Bits.create( { width: width , height: height } ) ;
	
	// Fill the buffer with data
	for ( y = 0 ; y < data.length ; y ++ )
	{
		if ( ! options.transparencyChar )
		{
			self.put( { x: 0 , y: y , attr: attr } , data[ y ] ) ;
		}
		else
		{
			len = data[ y ].length ;
			
			for ( x = 0 ; x < len ; x ++ )
			{
				if ( data[ y ][ x ] === options.transparencyChar )
				{
					self.put( { x: x , y: y , attr: attrTrans } , data[ y ][ x ] ) ;
				}
				else
				{
					self.put( { x: x , y: y , attr: attr } , data[ y ][ x ] ) ;
				}
			}
		}
	}
	
	return self ;
} ;



// Backward compatibility
ScreenBuffer24Bits.createFromChars = ScreenBuffer24Bits.createFromString ;



ScreenBuffer24Bits.prototype.blitterCellBlendingIterator = function blitterCellBlendingIterator( p )
{
	//var blending = p.context.srcBuffer.readUInt32BE( p.srcStart ) & this.TRANSPARENCY ;
	var blending = this.readAttr( p.context.srcBuffer , p.srcStart ) & this.TRANSPARENCY ;
	
	if ( blending === this.NONE )
	{
		// Fully visible, copy it
		p.context.srcBuffer.copy( p.context.dstBuffer , p.dstStart , p.srcStart , p.srcEnd ) ;
		return ;
	}
	
	if ( blending === this.TRANSPARENCY )
	{
		// Fully transparent, do nothing
		return ;
	}
	
	
	// Blending part...
	
	if ( ! ( blending & this.FG_TRANSPARENCY ) )
	{
		// Copy source foreground color
		p.context.srcBuffer.copy(
			p.context.dstBuffer ,
			p.dstStart + 3 ,
			p.srcStart + 3 ,
			p.srcStart + 4
		) ;
	}
	
	if ( ! ( blending & this.BG_TRANSPARENCY ) )
	{
		// Copy source background color
		p.context.srcBuffer.copy(
			p.context.dstBuffer ,
			p.dstStart + 2 ,
			p.srcStart + 2 ,
			p.srcStart + 3
		) ;
	}
	
	if ( ! ( blending & this.STYLE_TRANSPARENCY ) )
	{
		// Copy source style
		p.context.srcBuffer.copy(
			p.context.dstBuffer ,
			p.dstStart + 1 ,
			p.srcStart + 1 ,
			p.srcStart + 2
		) ;
	}
	
	if ( ! ( blending & this.CHAR_TRANSPARENCY ) )
	{
		// Copy source character
		p.context.srcBuffer.copy(
			p.context.dstBuffer ,
			p.dstStart + this.ATTR_SIZE ,
			p.srcStart + this.ATTR_SIZE ,
			p.srcEnd
		) ;
	}
} ;



ScreenBuffer24Bits.prototype.terminalBlitter = function terminalBlitter( p )
{
	var tr , iterator , iteratorCallback , context ;
	
	iteratorCallback = this.terminalBlitterLineIterator.bind( this ) ;
	
	context = {
		srcBuffer: this.buffer ,
		term: p.dst ,
		deltaEscapeSequence: p.dst.support.deltaEscapeSequence ,
		nfterm: p.dst.noFormat ,
		lastAttr: null ,
		sequence: '' ,
		cells: 0 ,
		moves: 0 ,
		attrs: 0 ,
		writes: 0
	} ;
	
	// Default options & iterator
	tr = {
		type: 'line' ,
		context: context ,
		dstRect: termkit.Rect.create( p.dst ) ,
		srcRect: termkit.Rect.create( this ) ,
		dstClipRect: p.dstClipRect ,
		srcClipRect: p.srcClipRect ,
		offsetX: p.offsetX ,
		offsetY: p.offsetY ,
		multiply: this.ITEM_SIZE
	} ;
	
	if ( p.delta )
	{
		if ( ! this.lastBuffer || this.lastBuffer.length !== this.buffer.length )
		{
			this.lastBuffer = Buffer.from( this.buffer ) ;
		}
		else if ( this.lastBufferUpToDate )
		{
			context.srcLastBuffer = this.lastBuffer ;
			
			iteratorCallback = this.terminalBlitterCellIterator.bind( this ) ;
			tr.type = 'cell' ;
		}
		
		this.lastBufferUpToDate = true ;
	}
	else
	{
		this.lastBufferUpToDate = false ;
	}
	
	
	if ( p.wrap ) { iterator = 'wrapIterator' ; }
	else if ( p.tile ) { iterator = 'tileIterator' ; }
	else { iterator = 'regionIterator' ; }
	
	termkit.Rect[ iterator ]( tr , iteratorCallback ) ;
	
	// Write remaining sequence
	if ( context.sequence.length ) { context.nfterm( context.sequence ) ; context.writes ++ ; }
	
	// Copy buffer to lastBuffer
	// Already done by terminalBlitterCellIterator()
	// if ( p.delta ) { this.buffer.copy( this.lastBuffer ) ; }
	
	// Return some stats back to the callee
	return {
		cells: context.cells ,
		moves: context.moves ,
		attrs: context.attrs ,
		writes: context.writes
	} ;
} ;



ScreenBuffer24Bits.prototype.terminalBlitterLineIterator = function terminalBlitterLineIterator( p )
{
	var offset , attr ;
	
	p.context.sequence += p.context.term.optimized.moveTo( p.dstXmin , p.dstY ) ;
	p.context.moves ++ ;
	
	for ( offset = p.srcStart ; offset < p.srcEnd ; offset += this.ITEM_SIZE )
	{
		//attr = p.context.srcBuffer.readUInt32BE( offset ) ;
		attr = this.readAttr( p.context.srcBuffer , offset ) ;
		
		if ( attr !== p.context.lastAttr )
		{
			p.context.sequence += p.context.lastAttr === null || ! p.context.deltaEscapeSequence ?
				this.generateEscapeSequence( p.context.term , attr ) :
				this.generateDeltaEscapeSequence( p.context.term , attr , p.context.lastAttr ) ;
			p.context.lastAttr = attr ;
			p.context.attrs ++ ;
		}
		
		p.context.sequence += this.readChar( p.context.srcBuffer , offset ) ;
		p.context.cells ++ ;
	}
	
	// Output buffering saves a good amount of CPU usage both for the node's processus and the terminal processus
	if ( p.context.sequence.length > this.OUTPUT_THRESHOLD )
	{
		p.context.nfterm( p.context.sequence ) ;
		p.context.sequence = '' ;
		p.context.writes ++ ;
	}
} ;



ScreenBuffer24Bits.prototype.terminalBlitterCellIterator = function terminalBlitterCellIterator( p )
{
	//var attr = p.context.srcBuffer.readUInt32BE( p.srcStart ) ;
	var attr = this.readAttr( p.context.srcBuffer , p.srcStart ) ;
	
	// If last buffer's cell === current buffer's cell, no need to refresh... skip that now
	if ( p.context.srcLastBuffer )
	{
		if (
			attr ===
				/*
				p.context.srcLastBuffer.readUInt32BE( p.srcStart ) &&
			p.context.srcBuffer.readUInt32BE( p.srcStart + this.ATTR_SIZE ) ===
				p.context.srcLastBuffer.readUInt32BE( p.srcStart + this.ATTR_SIZE ) )
			*/
				this.readAttr( p.context.srcLastBuffer , p.srcStart ) &&
			this.readAttr( p.context.srcBuffer , p.srcStart + this.ATTR_SIZE ) ===
				this.readAttr( p.context.srcLastBuffer , p.srcStart + this.ATTR_SIZE ) )
		{
			return ;
		}
		
		p.context.srcBuffer.copy( p.context.srcLastBuffer , p.srcStart , p.srcStart , p.srcEnd ) ;
	}
	
	p.context.cells ++ ;
	
	if ( p.dstX !== p.context.cx || p.dstY !== p.context.cy )
	{
		p.context.sequence += p.context.term.optimized.moveTo( p.dstX , p.dstY ) ;
		p.context.moves ++ ;
	}
	
	if ( attr !== p.context.lastAttr )
	{
		p.context.sequence += p.context.lastAttr === null || ! p.context.deltaEscapeSequence ?
			this.generateEscapeSequence( p.context.term , attr ) :
			this.generateDeltaEscapeSequence( p.context.term , attr , p.context.lastAttr ) ;
		p.context.lastAttr = attr ;
		p.context.attrs ++ ;
	}
	
	p.context.sequence += this.readChar( p.context.srcBuffer , p.srcStart ) ;
	
	// Output buffering saves a good amount of CPU usage both for the node's processus and the terminal processus
	if ( p.context.sequence.length > this.OUTPUT_THRESHOLD )
	{
		p.context.nfterm( p.context.sequence ) ;
		p.context.sequence = '' ;
		p.context.writes ++ ;
	}
	
	// Next expected cursor position
	p.context.cx = p.dstX + 1 ;
	p.context.cy = p.dstY ;
} ;



ScreenBuffer24Bits.loadSyncV2 = function loadSync( filepath )
{
	var i , content , header , screenBuffer ;
	
	// Let it crash if nothing found
	content = fs.readFileSync( filepath ) ;
	
	// See if we have got a 'SB' at the begining of the file
	if ( content.length < 3 || content.toString( 'ascii' , 0 , 3 ) !== 'SB\n' )
	{
		throw new Error( 'Magic number mismatch: this is not a ScreenBuffer24Bits file' ) ;
	}
	
	// search for the second \n
	for ( i = 3 ; i < content.length ; i ++ )
	{
		if ( content[ i ] === 0x0a ) { break ; }
	}
	
	if ( i === content.length )
	{
		throw new Error( 'No header found: this is not a ScreenBuffer24Bits file' ) ;
	}
	
	// Try to parse a JSON header
	try {
		header = JSON.parse( content.toString( 'utf8' , 3 , i ) ) ;
	}
	catch( error ) {
		throw new Error( 'No correct one-lined JSON header found: this is not a ScreenBuffer24Bits file' ) ;
	}
	
	// Mandatory header field
	if ( header.version === undefined || header.width === undefined || header.height === undefined )
	{
		throw new Error( 'Missing mandatory header data, this is a corrupted or obsolete ScreenBuffer24Bits file' ) ;
	}
	
	// Bad size?
	if ( content.length !== i + 1 + header.width * header.height * ScreenBuffer24Bits.prototype.ITEM_SIZE )
	{
		throw new Error( 'Bad file size: this is a corrupted ScreenBuffer24Bits file' ) ;
	}
	
	// So the file exists, create a canvas based upon it
	screenBuffer = ScreenBuffer24Bits.create( {
		width: header.width ,
		height: header.height
	} ) ;
	
	content.copy( screenBuffer.buffer , 0 , i + 1 ) ;
	
	return screenBuffer ;
} ;



// This new format use JSON header for a maximal flexibility rather than a fixed binary header.
// The header start with a magic number SB\n then a compact single-line JSON that end with an \n.
// So the data part start after the second \n, providing a variable header size.
// This will allow adding meta data without actually changing the file format.
ScreenBuffer24Bits.prototype.saveSyncV2 = function saveSync( filepath )
{
	var content , header ;
	
	header = {
		version: 2 ,
		width: this.width ,
		height: this.height
	} ;
	
	header = 'SB\n' + JSON.stringify( header ) + '\n' ;
	
	content = Buffer.allocUnsafe( header.length + this.buffer.length ) ;
	content.write( header ) ;
	
	this.buffer.copy( content , header.length ) ;
	
	// Let it crash if something bad happens
	fs.writeFileSync( filepath , content ) ;
} ;



ScreenBuffer24Bits.loadSync = ScreenBuffer24Bits.loadSyncV2 ;
ScreenBuffer24Bits.prototype.saveSync = ScreenBuffer24Bits.prototype.saveSyncV2 ;



ScreenBuffer24Bits.prototype.dump = function dump()
{
	var y , x , offset , str = '' ;
	
	for ( y = 0 ; y < this.height ; y ++ )
	{
		for ( x = 0 ; x < this.width ; x ++ )
		{
			offset = ( y * this.width + x ) * this.ITEM_SIZE ;
			
			str += string.format( '%x%x%x%x ' ,
				this.buffer.readUInt8( offset ) ,
				this.buffer.readUInt8( offset + 1 ) ,
				this.buffer.readUInt8( offset + 2 ) ,
				this.buffer.readUInt8( offset + 3 )
			) ;
			
			str += this.readChar( this.buffer , offset ) + ' ' ;
		}
		
		str += '\n' ;
	}
	
	return str ;
} ;



ScreenBuffer24Bits.prototype.readAttr = function readAttr( buffer , at )
{
	return buffer.readUInt32BE( at ) ;
} ;



ScreenBuffer24Bits.prototype.writeAttr = function writeAttr( buffer , attr , at )
{
	return buffer.writeUInt32BE( attr , at ) ;
} ;



ScreenBuffer24Bits.prototype.readChar = function readChar( buffer , at )
{
	var bytes ;
	
	at += this.ATTR_SIZE ;
	
	if ( buffer[ at ] < 0x80 ) { bytes = 1 ; }
	else if ( buffer[ at ] < 0xc0 ) { return '\x00' ; } // We are in a middle of an unicode multibyte sequence... something was wrong...
	else if ( buffer[ at ] < 0xe0 ) { bytes = 2 ; }
	else if ( buffer[ at ] < 0xf0 ) { bytes = 3 ; }
	else if ( buffer[ at ] < 0xf8 ) { bytes = 4 ; }
	else if ( buffer[ at ] < 0xfc ) { bytes = 5 ; }
	else { bytes = 6 ; }
	
	if ( bytes > this.CHAR_SIZE ) { return '\x00' ; }
	
	return buffer.toString( 'utf8' , at , at + bytes ) ;
} ;



ScreenBuffer24Bits.prototype.writeChar = function writeChar( buffer , char , at )
{
	return buffer.write( char , at + this.ATTR_SIZE , this.CHAR_SIZE ) ;
} ;



ScreenBuffer24Bits.prototype.generateEscapeSequence = function generateEscapeSequence( term , attr )
{
	var color = attr & 255 ;
	var bgColor = ( attr >>> 8 ) & 255 ;
	
	var esc = term.optimized.styleReset +
		term.optimized.color256[ color ] +
		term.optimized.bgColor256[ bgColor ] ;
	
	// Style part
	if ( attr & this.BOLD ) { esc += term.optimized.bold ; }
	if ( attr & this.DIM ) { esc += term.optimized.dim ; }
	if ( attr & this.ITALIC ) { esc += term.optimized.italic ; }
	if ( attr & this.UNDERLINE ) { esc += term.optimized.underline ; }
	if ( attr & this.BLINK ) { esc += term.optimized.blink ; }
	if ( attr & this.INVERSE ) { esc += term.optimized.inverse ; }
	if ( attr & this.HIDDEN ) { esc += term.optimized.hidden ; }
	if ( attr & this.STRIKE ) { esc += term.optimized.strike ; }
	
	return esc ;
} ;



// Generate only the delta between the last and new attributes, may speed up things for the terminal process
// as well as consume less bandwidth, at the cost of small CPU increase in the application process
ScreenBuffer24Bits.prototype.generateDeltaEscapeSequence = function generateDeltaEscapeSequence( term , attr , lastAttr )
{
	//console.log( 'generateDeltaEscapeSequence' ) ;
	
	var esc = '' ,
		color = attr & 255 ,
		lastColor = lastAttr & 255 ,
		bgColor = ( attr >>> 8 ) & 255 ,
		lastBgColor = ( lastAttr >>> 8 ) & 255 ;
	
	// Bold and dim style are particular: all terminal has noBold = noDim
	
	if ( color !== lastColor ) { esc += term.optimized.color256[ color ] ; }
	if ( bgColor !== lastBgColor ) { esc += term.optimized.bgColor256[ bgColor ] ; }
	
	if ( ( attr & this.BOLD_DIM ) !== ( lastAttr & this.BOLD_DIM ) )
	{
		if ( ( ( lastAttr & this.BOLD ) && ! ( attr & this.BOLD ) ) ||
			( ( lastAttr & this.DIM ) && ! ( attr & this.DIM ) ) )
		{
			esc += term.optimized.noBold ;
			if ( attr & this.BOLD ) { esc += term.optimized.bold ; }
			if ( attr & this.DIM ) { esc += term.optimized.dim ; }
		}
		else
		{
			if ( ( attr & this.BOLD ) && ! ( lastAttr & this.BOLD ) ) { esc += term.optimized.bold ; }
			if ( ( attr & this.DIM ) && ! ( lastAttr & this.DIM ) ) { esc += term.optimized.dim ; }
		}
	}
	
	if ( ( attr & this.ITALIC ) !== ( lastAttr & this.ITALIC ) )
	{
		esc += attr & this.ITALIC ? term.optimized.italic : term.optimized.noItalic ;
	}
	
	if ( ( attr & this.UNDERLINE ) !== ( lastAttr & this.UNDERLINE ) )
	{
		esc += attr & this.UNDERLINE ? term.optimized.underline : term.optimized.noUnderline ;
	}
	
	if ( ( attr & this.BLINK ) !== ( lastAttr & this.BLINK ) )
	{
		esc += attr & this.BLINK ? term.optimized.blink : term.optimized.noBlink ;
	}
	
	if ( ( attr & this.INVERSE ) !== ( lastAttr & this.INVERSE ) )
	{
		esc += attr & this.INVERSE ? term.optimized.inverse : term.optimized.noInverse ;
	}
	
	if ( ( attr & this.HIDDEN ) !== ( lastAttr & this.HIDDEN ) )
	{
		esc += attr & this.HIDDEN ? term.optimized.hidden : term.optimized.noHidden ;
	}
	
	if ( ( attr & this.STRIKE ) !== ( lastAttr & this.STRIKE ) )
	{
		esc += attr & this.STRIKE ? term.optimized.strike : term.optimized.noStrike ;
	}
	
	return esc ;
} ;





			/* "static" functions: they exist in both static and non-static for backward compatibility */



ScreenBuffer24Bits.attr2object = function attr2object( attr )
{
	var object = {} ;
	
	object.color = attr & 255 ;
	object.bgColor = ( attr >>> 8 ) & 255 ;
	
	// Style part
	if ( attr & ScreenBuffer24Bits.prototype.BOLD ) { object.bold = true ; }
	if ( attr & ScreenBuffer24Bits.prototype.DIM ) { object.dim = true ; }
	if ( attr & ScreenBuffer24Bits.prototype.ITALIC ) { object.italic = true ; }
	if ( attr & ScreenBuffer24Bits.prototype.UNDERLINE ) { object.underline = true ; }
	if ( attr & ScreenBuffer24Bits.prototype.BLINK ) { object.blink = true ; }
	if ( attr & ScreenBuffer24Bits.prototype.INVERSE ) { object.inverse = true ; }
	if ( attr & ScreenBuffer24Bits.prototype.HIDDEN ) { object.hidden = true ; }
	if ( attr & ScreenBuffer24Bits.prototype.STRIKE ) { object.strike = true ; }
	
	// Blending part
	if ( attr & ScreenBuffer24Bits.prototype.FG_TRANSPARENCY ) { object.fgTransparency = true ; }
	if ( attr & ScreenBuffer24Bits.prototype.BG_TRANSPARENCY ) { object.bgTransparency = true ; }
	if ( attr & ScreenBuffer24Bits.prototype.STYLE_TRANSPARENCY ) { object.styleTransparency = true ; }
	if ( attr & ScreenBuffer24Bits.prototype.CHAR_TRANSPARENCY ) { object.charTransparency = true ; }
	if ( ( attr & ScreenBuffer24Bits.prototype.TRANSPARENCY ) === ScreenBuffer24Bits.prototype.TRANSPARENCY ) { object.transparency = true ; }
	
	return object ;
} ;



ScreenBuffer24Bits.prototype.attr2object = function attr2object( attr )
{
	var object = {} ;
	
	object.color = attr & 255 ;
	object.bgColor = ( attr >>> 8 ) & 255 ;
	
	// Style part
	if ( attr & this.BOLD ) { object.bold = true ; }
	if ( attr & this.DIM ) { object.dim = true ; }
	if ( attr & this.ITALIC ) { object.italic = true ; }
	if ( attr & this.UNDERLINE ) { object.underline = true ; }
	if ( attr & this.BLINK ) { object.blink = true ; }
	if ( attr & this.INVERSE ) { object.inverse = true ; }
	if ( attr & this.HIDDEN ) { object.hidden = true ; }
	if ( attr & this.STRIKE ) { object.strike = true ; }
	
	// Blending part
	if ( attr & this.FG_TRANSPARENCY ) { object.fgTransparency = true ; }
	if ( attr & this.BG_TRANSPARENCY ) { object.bgTransparency = true ; }
	if ( attr & this.STYLE_TRANSPARENCY ) { object.styleTransparency = true ; }
	if ( attr & this.CHAR_TRANSPARENCY ) { object.charTransparency = true ; }
	if ( ( attr & this.TRANSPARENCY ) === this.TRANSPARENCY ) { object.transparency = true ; }
	
	return object ;
} ;



ScreenBuffer24Bits.object2attr = function object2attr( object )
{
	var attr = 0 ;
	
	if ( ! object || typeof object !== 'object' ) { object = {} ; }
	
	// Color part
	if ( typeof object.color === 'string' ) { object.color = termkit.color2index( object.color ) ; }
	if ( typeof object.color !== 'number' || object.color < 0 || object.color > 255 ) { object.color = 7 ; }
	else { object.color = Math.floor( object.color ) ; }
	
	attr += object.color ;
	
	// Background color part
	if ( typeof object.bgColor === 'string' ) { object.bgColor = termkit.color2index( object.bgColor ) ; }
	if ( typeof object.bgColor !== 'number' || object.bgColor < 0 || object.bgColor > 255 ) { object.bgColor = 0 ; }
	else { object.bgColor = Math.floor( object.bgColor ) ; }
	
	attr += object.bgColor << 8 ;
	
	// Style part
	if ( object.bold ) { attr |= ScreenBuffer24Bits.prototype.BOLD ; }
	if ( object.dim ) { attr |= ScreenBuffer24Bits.prototype.DIM ; }
	if ( object.italic ) { attr |= ScreenBuffer24Bits.prototype.ITALIC ; }
	if ( object.underline ) { attr |= ScreenBuffer24Bits.prototype.UNDERLINE ; }
	if ( object.blink ) { attr |= ScreenBuffer24Bits.prototype.BLINK ; }
	if ( object.inverse ) { attr |= ScreenBuffer24Bits.prototype.INVERSE ; }
	if ( object.hidden ) { attr |= ScreenBuffer24Bits.prototype.HIDDEN ; }
	if ( object.strike ) { attr |= ScreenBuffer24Bits.prototype.STRIKE ; }
	
	// Blending part
	if ( object.transparency ) { attr |= ScreenBuffer24Bits.prototype.TRANSPARENCY ; }
	if ( object.fgTransparency ) { attr |= ScreenBuffer24Bits.prototype.FG_TRANSPARENCY ; }
	if ( object.bgTransparency ) { attr |= ScreenBuffer24Bits.prototype.BG_TRANSPARENCY ; }
	if ( object.styleTransparency ) { attr |= ScreenBuffer24Bits.prototype.STYLE_TRANSPARENCY ; }
	if ( object.charTransparency ) { attr |= ScreenBuffer24Bits.prototype.CHAR_TRANSPARENCY ; }
	
	return attr ;
} ;



ScreenBuffer24Bits.prototype.object2attr = function object2attr( object )
{
	var attr = 0 ;
	
	if ( ! object || typeof object !== 'object' ) { object = {} ; }
	
	// Color part
	if ( typeof object.color === 'string' ) { object.color = termkit.color2index( object.color ) ; }
	if ( typeof object.color !== 'number' || object.color < 0 || object.color > 255 ) { object.color = 7 ; }
	else { object.color = Math.floor( object.color ) ; }
	
	attr += object.color ;
	
	// Background color part
	if ( typeof object.bgColor === 'string' ) { object.bgColor = termkit.color2index( object.bgColor ) ; }
	if ( typeof object.bgColor !== 'number' || object.bgColor < 0 || object.bgColor > 255 ) { object.bgColor = 0 ; }
	else { object.bgColor = Math.floor( object.bgColor ) ; }
	
	attr += object.bgColor << 8 ;
	
	// Style part
	if ( object.bold ) { attr |= this.BOLD ; }
	if ( object.dim ) { attr |= this.DIM ; }
	if ( object.italic ) { attr |= this.ITALIC ; }
	if ( object.underline ) { attr |= this.UNDERLINE ; }
	if ( object.blink ) { attr |= this.BLINK ; }
	if ( object.inverse ) { attr |= this.INVERSE ; }
	if ( object.hidden ) { attr |= this.HIDDEN ; }
	if ( object.strike ) { attr |= this.STRIKE ; }
	
	// Blending part
	if ( object.transparency ) { attr |= this.TRANSPARENCY ; }
	if ( object.fgTransparency ) { attr |= this.FG_TRANSPARENCY ; }
	if ( object.bgTransparency ) { attr |= this.BG_TRANSPARENCY ; }
	if ( object.styleTransparency ) { attr |= this.STYLE_TRANSPARENCY ; }
	if ( object.charTransparency ) { attr |= this.CHAR_TRANSPARENCY ; }
	
	return attr ;
} ;





			/* Constants */



// Data structure
ScreenBuffer24Bits.prototype.ATTR_SIZE = 4 ;	// do not edit, everything use Buffer.writeInt32BE()
ScreenBuffer24Bits.prototype.CHAR_SIZE = 4 ;
ScreenBuffer24Bits.prototype.ITEM_SIZE = ScreenBuffer24Bits.prototype.ATTR_SIZE + ScreenBuffer24Bits.prototype.CHAR_SIZE ;

ScreenBuffer24Bits.prototype.DEFAULT_ATTR = ScreenBuffer24Bits.object2attr( { color: 'white' , bgColor: 'black' } ) ;
ScreenBuffer24Bits.prototype.CLEAR_ATTR = ScreenBuffer24Bits.object2attr( { color: 'white' , bgColor: 'black' , transparency: true } ) ;
ScreenBuffer24Bits.prototype.CLEAR_BUFFER = Buffer.allocUnsafe( ScreenBuffer24Bits.prototype.ITEM_SIZE ) ;
ScreenBuffer24Bits.prototype.CLEAR_BUFFER.writeInt32BE( ScreenBuffer24Bits.prototype.DEFAULT_ATTR , 0 ) ;
ScreenBuffer24Bits.prototype.CLEAR_BUFFER.write( ' \x00\x00\x00' , ScreenBuffer24Bits.prototype.ATTR_SIZE ) ;	// space



// Style mask
ScreenBuffer24Bits.prototype.BOLD = 1 << 16 ;
ScreenBuffer24Bits.prototype.DIM = 2 << 16 ;
ScreenBuffer24Bits.prototype.ITALIC = 4 << 16 ;
ScreenBuffer24Bits.prototype.UNDERLINE = 8 << 16 ;
ScreenBuffer24Bits.prototype.BLINK = 16 << 16 ;
ScreenBuffer24Bits.prototype.INVERSE = 32 << 16 ;
ScreenBuffer24Bits.prototype.HIDDEN = 64 << 16 ;
ScreenBuffer24Bits.prototype.STRIKE = 128 << 16 ;

ScreenBuffer24Bits.prototype.BOLD_DIM = ScreenBuffer24Bits.prototype.BOLD | ScreenBuffer24Bits.prototype.DIM ;



// Blending mask
ScreenBuffer24Bits.prototype.FG_TRANSPARENCY = 1 << 24 ;
ScreenBuffer24Bits.prototype.BG_TRANSPARENCY = 2 << 24 ;
ScreenBuffer24Bits.prototype.STYLE_TRANSPARENCY = 4 << 24 ;
ScreenBuffer24Bits.prototype.CHAR_TRANSPARENCY = 8 << 24 ;
ScreenBuffer24Bits.prototype.TRANSPARENCY =
	ScreenBuffer24Bits.prototype.FG_TRANSPARENCY |
	ScreenBuffer24Bits.prototype.BG_TRANSPARENCY |
	ScreenBuffer24Bits.prototype.STYLE_TRANSPARENCY |
	ScreenBuffer24Bits.prototype.CHAR_TRANSPARENCY ;

ScreenBuffer24Bits.prototype.FG_BLENDING = 16 << 24 ;
ScreenBuffer24Bits.prototype.BG_BLENDING = 32 << 24 ;

ScreenBuffer24Bits.prototype.LEADING_FULLWIDTH = 64 << 24 ;
ScreenBuffer24Bits.prototype.TRAILING_FULLWIDTH = 128 << 24 ;



// Tuning
ScreenBuffer24Bits.prototype.OUTPUT_THRESHOLD = 10000 ;	// minimum amount of data to retain before sending them to the terminal



// ScreenBuffer files
ScreenBuffer24Bits.prototype.HEADER_SIZE = 40 ;	// Header consists of 40 bytes



// General purpose flags
ScreenBuffer24Bits.prototype.NONE = 0 ;	// Nothing

