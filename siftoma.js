class sifConverter {
	/**
	 * Create a new sifConverter instance.
	 */
	constructor () {
		this.clear();
	}

	/**
	 * To match lives declaration from crawler data.
	 */
	static get liveRegex() {
		return /\s*var\s+lives\s*=\s*(\[.*\])\s*/;
	}

	/**
	 * Get epsilon
	 */
	static get EPS() {
		return 0.0015;
	}

	/**
	 * Beat division list.
	 */
	static get divlist() {
		return [{v: 6, w: 0.8}, {v: 4, w: 1}];
	}

	/**
	 * Hold notes.
	 */
	static  isHold(val) {
		return val == 3 || val == 13;
	}

	/**
	 * To avoid CORS.
	 * @param {string} url Actual url to the data.
	 */
	static CORS(url) {
		return 'http://api.allorigins.ml/get?url=' + encodeURIComponent(url) + '&callback=?&method=raw';
	}

	/**
	 * Get filename from path.
	 * @param {string} path
	 * @param {boolean} extension Whether extension should be included
	 */
	static getFilename(path, extension = true) {
		let arr = path.split('/');
		let ret = arr[arr.length-1];
		if (!extension) {
			arr = ret.split('.');
			if (arr.length > 1)
				arr.pop();
			ret = arr.join('.');
		}
		return ret;
	}

	/**
	 * Clear all information
	 */
	clear() {
		this.lives = null;
		this.malives = [];
		this.info = [];
	}

	/**
	 * Greatest common divisor
	 * @param {number} a 
	 * @param {number} b 
	 */
	static gcd(a, b) {
		a = parseInt(a);
		b = parseInt(b);
		if (a == 0)
			return b;
		if (b == 0)
			return a;
		return sifConverter.gcd(b, a%b);
	}

	/**
	 * Update metadata of ma chart
	 * @param {object} data 
	 * @param {object} ma 
	 */
	static updateMeta(data, ma) {
		ma.meta = {
			creator: data.creator,
			background: data.backgroundname,
			version: data.version,
			id: 0,
			mode: 0,
			time: parseInt(new Date().getTime() / 1000),
			song: {
				title: data.nameromaji,
				artist: data.artist,
				id: 0
			},
			mode_ext: {
				column: 9
			}
		}
	}

	/**
	 * Get the regular path for card viewer.
	 * @param {string} path 
	 */
	static getRealpath(path) {
		let arr = path.split('/');
		while (arr[0].length == 0)
			arr = arr.splice(1);
		if (arr[0] != 'asset') {
			if (arr[0] != 'assets') {
				arr.unshift('assets');
			}
			arr.unshift('asset');
		}
		arr.unshift('https://card.niconi.co.ni');
		return arr.join('/');
	}

	/**
	 * Get difficulty description from integer.
	 * @param {number} level 
	 */
	static difficultyMap(level) {
		switch (level) {
			case 0:
				return 'AC';
			case 1:
				return 'Easy';
			case 2:
				return 'Normal';
			case 3:
				return 'Hard';
			case 4:
				return 'Expert';
			case 5:
				return 'Master';
			case 6:
				return 'Master';
			default:
				return 'Unknown';
		}
	}

	/**
	 * @returns {array} Most reliable notes list for bpm detecting.
	 */
	get maxsizeNotes() {
		let cur = -1;
		let ret = null;
		for (let i in this.info) {
			let data = this.info[i];
			if (data.notes.length > cur) {
				cur = data.notes.length;
				ret = data;
			}
		}
		return ret;
	}

	/**
	 * Get encoded MA note.
	 * @param {object} note A card viewer note
	 * @param {number} bpm
	 * @param {number} offset
	 */
	static getMaNote(note, bpm, offset, effect = false) {
		let t = note.timing_sec + offset / 1000;
		if (effect) {
			t += note.effect_value;
		}
		let beat = 60 / bpm;
		let step = Math.floor(t / beat + sifConverter.EPS * 5);
		t -= step * beat;
		let ret = [step, 0, 1];
		let minDiff = 1e9;
		sifConverter.divlist.forEach(tmp => {
			let val = tmp.v;
			let cnt = Math.round(t / (beat / val));
			let real = cnt * (beat / val);
			let diff = Math.abs(t-real);
			if (minDiff > diff) {
				minDiff = diff;
				let g = sifConverter.gcd(cnt, val);
				ret[1] = cnt / g;
				ret[2] = val / g;
			}
		});
		if (ret[2] <= ret[1])
			console.log('error: ', ret);
		return ret;
	}

	/**
	 * Fix: weighted notes
	 * @param {number} t time interval
	 * @returns {number} Weight (correctness) of the note
	 */
	static getNoteWeight(t, beat) {
		let ret = 0;
		t = Math.round(t * 1000) / 1000;
		sifConverter.divlist.forEach(val => {
			let diff = Math.round(t / (beat / val.v));
			let real = Math.round(diff * (beat / val.v) * 1000) / 1000;
			let g = sifConverter.gcd(diff, val.v);
			if (Math.abs(t - real) <= sifConverter.EPS)
				ret = Math.max(ret, g / val.v * val.w * (1-t+real));
		});
		return ret;
	}

	/**
	 * Detect BPM of given notes list.
	 * @param {array} notes
	 * @returns {number} 
	 */
	static detectBPM(notes) {
		let maxCorrectCount = -1;
		let bpm = -1;
		let offset = -1;
		// compute BPM
		for (let i = 115; i < 230; i++) {
			let correctCount = 0;
			let beat = 60 / i;
			for (let j=1; j < notes.length; j++) {
				let t = notes[j].timing_sec - notes[j-1].timing_sec;
				correctCount += sifConverter.getNoteWeight(t, beat);
				// hold
				if (sifConverter.isHold(notes[j].effect)) {
					correctCount += sifConverter.getNoteWeight(notes[j].effect, beat);
				}
			}
			if (correctCount > maxCorrectCount) {
				maxCorrectCount = correctCount;
				bpm = i;
			}
		}
		// compute offset
		let maxval = -1;
		let visited = {};
		let beat = 60 / bpm;
		notes.forEach(note => {
			let t = note.timing_sec;
			let next = Math.ceil(t / beat);
			let currentOffset = Math.round((next * beat - t) * 1000);
			if (visited[currentOffset])
				return;
			visited[currentOffset] = true;
			let curval = 0;
			notes.forEach(cur => {
				let manote = sifConverter.getMaNote(cur, bpm, currentOffset);
				curval += 100 / manote[2];
				// hold
				if (sifConverter.isHold(cur.effect)) {
					manote = sifConverter.getMaNote(cur, bpm, currentOffset, true);
					curval += 50 / manote[2];
				}
			});
			if (curval > maxval) {
				maxval = curval;
				offset = currentOffset;
			}
		});
		return [bpm, offset];
	}

	/**
	 * Check if there are swing notes
	 */
	get hasSwing() {
		let ret = false;
		this.info.forEach(data => {
			if (data.swing)
				ret = true;
		});
		return ret;
	}

	/**
	 * Hardcode offset
	 */
	static get offsetDelta() {
		return 51;
	}

	/**
	 * Convert notes list to MA format.
	 * @param {array} notes A note list.
	 * @param {object} ma A ma chart object.
	 * @param {number} bpm Given BPM.
	 * @param {number} offset Given offset.
	 */
	static convertNotesList(data, ma, bpm = null, offset = null) {
		let notes = data.notes;
		if (!bpm || !offset) {
			[bpm, offset] = sifConverter.detectBPM(notes);
		} else {
			offset -= sifConverter.offsetDelta;
		}
		data.bpm = bpm;
		data.offset = offset + sifConverter.offsetDelta;
		ma.time = [{
			beat: [0,0,1],
			bpm: bpm
		}];
		let infonote = ma.note[ma.note.length-1];
		ma.note = [];
		for (let i in notes) {
			let e = notes[i].effect;
			let p = notes[i].position;
			let add = {
				column: 9-p
			};
			let manote = sifConverter.getMaNote(notes[i], bpm, offset);
			add.beat = manote;
			if (sifConverter.isHold(e)) {
				manote = sifConverter.getMaNote(notes[i], bpm, offset, true);
				add.endbeat = manote;
			}
			ma.note.push(add);
		}
		infonote.offset = data.offset;
		ma.note.push(infonote);
	}

	/**
	 * Generate notes for all charts stored.
	 * @param {number} bpm 
	 * @param {number} offset 
	 */
	generateNotes(bpm = null, offset = null) {
		for (let i in this.info) {
			let data = this.info[i];
			sifConverter.convertNotesList(data, this.malives[i], bpm, offset);
		}
	}

	/**
	 * Analyze fetched lives and store it to ma chart data.
	 * @param {object} lives Array of lives
	 * @param {function} resolve To resolve promise if any
	 * @param {function} reject To reject promise if any
	 */
	analyzeLives(lives, resolve = () => {}, reject = () => {}) {
		this.lives = lives;
		this.malives = [];
		this.info = [];
		for (let i in lives) {
			let live = lives[i];
			let background;
			if (live.asset_background)
				background = sifConverter.getRealpath(live.asset_background);
			else
				background = sifConverter.getRealpath(live.background_asset);
			let liveicon;
			if (live.live_icon_asset)
				liveicon = sifConverter.getRealpath(live.live_icon_asset);
			else
				liveicon = sifConverter.getRealpath(live.jacket_asset);
			let audiopath = sifConverter.getRealpath(live.sound_asset);
			let nameromaji = 'No data';
			if (live.name_kana)
				nameromaji = wanakana.toRomaji(live.name_kana);
			// analyze data
			let data = {
				creator: 'SIFConverter',
				artist: 'No data',
				background: background,
				backgroundname: sifConverter.getFilename(background),
				audio: audiopath,
				audioname: sifConverter.getFilename(audiopath),
				liveicon: liveicon,
				name: live.name,
				nameromaji: nameromaji,
				difficulty: live.difficulty,
				stageLevel: live.stage_level,
				swing: live.swing_flag,
				notes: live.notes_list,
				bpm: 120,
				offset: 0
			};
			data.version = '9K ' + sifConverter.difficultyMap(data.difficulty) + ' Lv.' + data.stageLevel;
			// convert ma map
			let ma = {
				meta: {},
				time: [],
				note: [{
					beat: [0,0,1],
					sound: data.audioname,
					vol: 100,
					offset: 0,
					type: 1
				}],
				extra: {
					test: {
						divide: 4,
						speed: 100,
						save: 0,
						lock: 0,
						edit_mode: 0
					}
				}
			};
			sifConverter.updateMeta(data, ma);
			this.malives.push(ma);
			this.info.push(data);
			// console.log(data);
			// console.log(ma);
		}
		this.generateNotes();
		resolve('Success');
	}

	analyze(url) {
		let converter = this;
		return new Promise(function(resolve, reject) {
			$.get({url: sifConverter.CORS(url)})
			.then((response) => {
				let match = sifConverter.liveRegex.exec(response);
				if (match == null) {
					reject('No live information found.');
					return;
				}
				let lives = JSON.parse(match[1]);
				for (let i in lives) {
					lives[i].notes_list = JSON.parse(lives[i].notes_list);
				}
				converter.analyzeLives(lives, resolve, reject);
			}, reject);
		});
	}
};