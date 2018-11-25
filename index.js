let vdata = null;
let converter = null;
let zip = null;

$(document).ready(() => {
	// vue.js
	vdata = new Vue({
		el: '#app',
		data: {
			urls: [],
			sifConverter: sifConverter,
			meta: null,
			metasuccess: false,
			alert: null,
			urlID: 0,
			processing: false
		},
		methods: {
			addUrl: function() {
				this.urls.push({
					u: '',
					v: '',
					c: new sifConverter(),
					id: this.urlID++
				});
			},
			cancel: function() {
				this.metasuccess = false;
				this.meta = null;
				this.alert = null;
			}
		},
	});
	vdata.addUrl();
});

/**
 * To analyze all URL inputs.
 */
function analyzeURL() {
	vdata.meta = {};
	vdata.alert = null;
	let promises = [];
	for (let i in vdata.urls) {
		let url = vdata.urls[i];
		let str = url.u.trim();
		if (str.length == 0) {
			url.c.clear();
			continue;
		}
		promises.push(url.c.analyze(str));
	}
	if (promises.length == 0) {
		vdata.alert = 'No live input.';
		vdata.meta = null;
		return;
	}
	Promise.all(promises).then((responses) => {
		selectBestMatch();
	}, (response) => {
		vdata.alert = response;
		vdata.meta = null;
	});
	return;
}

/**
 * Choose data from all datasets.
 */
function selectBestMatch() {
	// Check validity
	let suc = true;
	let fields = {
		name: null,
		nameromaji: null,
		audio: null,
		audioname: null
	}
	let maxcnt = -1;
	vdata.urls.forEach(url => {
		let mdata = url.c.maxsizeNotes;
		if (mdata == null)
			return;
		if (mdata.notes.length > maxcnt) {
			maxcnt = mdata.notes.length;
			vdata.meta = mdata;
		}
		url.c.info.forEach(data => {
			url.v = data.version;
			for (let key in fields) {
				if (!fields[key]) {
					fields[key] = data[key];
				} else if (fields[key] != data[key]) {
					suc = false;
				}
			}
		});
		if (url.c.hasSwing) {
			vdata.alert = 'Swing notes detected: will be converted to normal notes.';
		}
	});
	if (!suc)
		vdata.alert = 'Warning: Inconsistent information, please check if charts come from the same song.';
	vdata.metasuccess = true;
}

/**
 * Filter unique values from array
 */
function uniqueFilter(value, index, self) {
	for (let i in self) {
		let cur = self[i];
		if (value.url == cur.url)
			return index == i;
	}
	return true;
}

/**
 * download background image
 */
function downloadBackgroundImage() {
	return new Promise((resolve, reject) => {
		let promises = [];
		let images = [];
		vdata.urls.forEach(url => {
			url.c.info.forEach(data => {
				images.push({url: data.background, name: data.backgroundname});
			});
		});
		images = images.filter(uniqueFilter);
		images.forEach(url => {
			let tmp = new Promise((resolve, reject) => {
				fetch(sifConverter.CORS(url.url))
				.then((response) => {
					zip.file(url.name, response.blob(), {binary: true});
					resolve('Downloaded' + url.name);
				}, reject);
			});
			promises.push(tmp);
		});
		promises.push(new Promise((resolve, reject) => {
			let audio = vdata.meta.audio;
			let audioname = vdata.meta.audioname;
			fetch(sifConverter.CORS(audio))
			.then((response) => {
				zip.file(audioname, response.blob(), {binary: true});
				resolve('Downloaded audio file');
			}, reject);
		}));
		Promise.all(promises)
		.then(response => {
			resolve('Background image downloaded.');
		}, reject);
	});
}

/**
 * Modify metadata and generate notes
 */
function ModifyMeta() {
	return new Promise((resolve, reject) => {
		let bpm = parseFloat(vdata.meta.bpm);
		let offset = parseInt(vdata.meta.offset);
		vdata.urls.forEach(url => {
			for (let i in url.c.info) {
				let data = url.c.info[i];
				let ma = url.c.malives[i];
				sifConverter.updateMeta(vdata.meta, ma);
				ma.meta.version = url.v;
				sifConverter.convertNotesList(data, ma, bpm, offset);
				zip.file(url.id + '_' + i + '.mc', JSON.stringify(ma, undefined, 4));
			}
		});
		resolve('Charts generated.');
	});
}

/**
 * download chart files
 */
function getFiles() {
	vdata.processing = true;
	vdata.alert = null;
	zip = new JSZip();
	// Modify metadata and generate notes
	let promises = [downloadBackgroundImage(), ModifyMeta()];
	Promise.all(promises).then((responses) => {
		zip.generateAsync({type: 'blob'})
		.then(function(content) {
			saveAs(content, vdata.meta.nameromaji + '.mcz');
			vdata.processing = false;
		});
	}, (response) => {
		vdata.alert = response;
		vdata.processing = false;
	});
}