/**
	*
	*	input MTG card thumbnails from scryfall.com
	* synthisize faux real-world versions from these uniform images
	*
	* Pipeline:
	* 	clip white corner tips off from card
	* 	randomize camera perspective
	* 	randomize brightness
	* 	randomize background
	*
	**/


import path  from 'path';
import fs 	 from 'fs';
import sharp from 'sharp';
import h 		 from 'hasard';
import cv 	 from 'opencv4nodejs';
import IA 	 from 'image-augment';


// TODO:
// 			save clipper to disk

// custom clip image that crops the white corners
// from each card photo
// this gets saved in memory during processing of first image
let clipper;
// force all png images along the pipeline to be transparent
const clearBkgnd = {r: 0, g: 0, b: 0, alpha: 0};
// Initialize image-augment with cv backend
const ia = IA(cv);
const IMAGE_SIZE = 224; // mobilenet input size === 224
sharp.cache(false); // without this, the noise clip doesn't change for each image

// used to modulate image brightness in final pipeline step
const randomRange = (min, max) => Math.random() * (max - min) + min;

// Create an augmentation pipeline for random noise background generation
const addNoise = ia.sequential([
	// Add a noise with a standard deviation of 300
	// perChannel creates random colored pixels
	ia.additiveNoise({sigma: 100, perChannel: true})
]);
// this pipeline randomizes the cards position and camera angle in the frame
// in an attempt to mimic real world data
const randomCameraAugmentation = ia.sequential([
  ia.affine({
    // Scale images to 80-120% of their size, individually per axis
    scale: h.number(0.95, 1.05),
    // Translate by -20 to +20 percent (per axis)
    translatePercent: h.array([h.number(-0.1, 0.1), h.number(-0.05, 0.05)]),
    // Rotate by -45 to +45 degrees
    rotate: h.number(-3, 3),
    // Shear by -16 to +16 degrees
    shear: h.number(-3, 3),

		borderType: 'transparent'
  })
]);


const getAllPaths = async (imgsDir, directories) => {	
	// get all filenames from each sub directory
	const pathPromises = directories.map(dir => {
  	const filePath = path.join(imgsDir, dir);
  	return fs.promises.readdir(filePath);
  });
	// 2d array of filenames
  const pathArrays = await Promise.all(pathPromises);
  // match filenames with directories to get full paths for each file
  const paths = directories.reduce((accum, dir, index) => {
  	const filePaths = pathArrays[index].map(filePath => path.join(imgsDir, dir, filePath));
  	accum[dir] = filePaths;
  	return accum;
  }, {});

  return paths;
};

// Tight clip of scryfall MTG card.
// Discard white tipped corners.
const clipImage = async filename => {
	// hold clipper image in memory
	if (!clipper) {
		const height = 204;
		const width  = 146;
		const clipFileName = '/Users/claymation296/dev/magic/card_clip.png';
		// tweak clipping image to fit card data slightly tighter
		const clip = await sharp(clipFileName).
	    resize({
    		background: clearBkgnd,
	    	fit: sharp.fit.cover, 
	    	height, 
	    	width
	    }).
	    extend({bottom: 0, left: 1, right: 0, top: 0}).
	    png().
	    toBuffer();

	  clipper = await sharp(clip).
	  	resize({
    		background: clearBkgnd,
	  		fit: sharp.fit.fill, 
	  		height, 
	  		width
	  	}).
	  	png().
	    toBuffer();
	}
	// cut corners off card img so its original
	// rounded corners are left
  const clipped = await sharp(filename).
    composite([{
      input: clipper,
      blend: 'dest-out'
    }]).
    png().
    toBuffer();
  // size clipped card img to fill frame
  // so that it is not cut off from random placement
  // in next step
  const resized =  await sharp(clipped).
    resize({
    	background: clearBkgnd,
    	fit: sharp.fit.contain, 
    	height: IMAGE_SIZE, 
    	width: IMAGE_SIZE
    }).
    png().
    toBuffer();

  return resized;
};

// use image-augment to randomize camera perspective
const randomPositionCam = async buffer => {
	const image = cv.imdecode(buffer, cv.IMREAD_UNCHANGED);
	const {images} = await randomCameraAugmentation.read({images: [image]});
	return cv.imencode('.png', images[0]);
};
// create a unique random background for every photo
// so ml can deal with real-world background clutter
const makeRandomNoisyBackground = async () => {
	// start with a grey background that will have noise added
	// noise pipeline uses a sigma standard deviation from
	// a given val, so use middle value (grey) as starting point
	const buffer = await sharp({
		  create: {
		    width: 			IMAGE_SIZE,
		    height: 		IMAGE_SIZE,
		    channels: 	4,
		    background: {r: 127, g: 127, b: 127, alpha: 1}
		  }
		}).
		png().
		toBuffer();
	// cv encodes to a Mat (matrix) class object that MUST be used
	// for image-augment pipeline, so encode from buffer to matrix, 
	// process, then decode back to buffer
	const image = cv.imdecode(buffer);
	const {images} = await addNoise.read({images: [image]});
	return cv.imencode('.png', images[0]);
};
// Overlay processed card onto a noisy background img.
// Randomly modulate image brightness.
const addBackground = async buffer => {
	const background = await makeRandomNoisyBackground();
	const withBkgnd = await sharp(background).
		composite([{
      input: buffer,
      blend: 'over'
    }]).
    toBuffer();

	return sharp(withBkgnd).
		modulate({
	    brightness: randomRange(0.8, 1.2) // modulate lightness +-20%
	  }).
    jpeg(). // jpeg is 10X smaller for faster training
    toBuffer();
};

// Iterate over all files in all sub folders in the input dir.
const process = async (imgsDir, outDir) => {
	// create output dir
	await fs.promises.mkdir(outDir, {recursive: true});
	// read imgsDir to get its sub directories
	const allDirectories = await fs.promises.readdir(imgsDir);
	const directories 	 = allDirectories.filter(dir => dir !== '.DS_Store'); // fix for apple directories
	const readPaths 		 = await getAllPaths(imgsDir, directories);

	for (const directory of directories) {
		console.log('set: ', directory);
		const filenames = readPaths[directory];
		for (const filename of filenames) {	
			const clipped		= await clipImage(filename);
			const randomPos = await randomPositionCam(clipped);
			const data 			= await addBackground(randomPos);
			const outSubDir = path.join(outDir, directory);
			const outPath 	= path.join(outSubDir, path.basename(filename));
			await fs.promises.mkdir(outSubDir, {recursive: true});
			await fs.promises.writeFile(outPath, data);
		}
	}

	// use for testing single image
	// may have to output png's if testing in 
	// the middle of the pipeline
	// const directory = directories[0];
	// const filenames = readPaths[directory];
	// const filename = filenames[0];
		
	// const clipped		= await clipImage(filename);
	// const randomPos = await randomPositionCam(clipped);
	// const data 			= await addBackground(randomPos);
	// const outSubDir = path.join(outDir, directory);
	// const outPath 	= path.join(outSubDir, path.basename(filename));
	// // force png output
	// const name = path.basename(filename, '.jpg');
	// const outPath = path.format({dir: outSubDir, name, ext: '.png'});

	// await fs.promises.mkdir(outSubDir, {recursive: true});
	// await fs.promises.writeFile(outPath, data);
};


export default process;
