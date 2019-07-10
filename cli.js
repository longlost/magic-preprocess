
import minimist from 'minimist';
import process  from './data.js';

const parseArguments = argv => {	
	const args = minimist(argv.slice(2), {
	  string: ['images_dir', 'output_dir']
	});

	if (!args.images_dir) {
	  throw new Error('--images_dir not specified.');
	}

	if (!args.output_dir) {
	  throw new Error('--output_dir not specified.');
	}

	return args;
};


export async function cli(args) {
	const {
		images_dir: imgsDir,
		output_dir: outDir
	} = parseArguments(args);
	await process(imgsDir, outDir);
	console.log('😈');
}