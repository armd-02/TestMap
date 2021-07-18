/*	Main Process */
"use strict";

// Global Variable
var Conf = {};					// Config Praams
const LANG = (window.navigator.userLanguage || window.navigator.language || window.navigator.browserLanguage).substr(0, 2) == "ja" ? "ja" : "en";
const FILES = ["./baselist.html", "./data/config.json", './data/system.json', './data/overpass.json', `./data/category-${LANG}.json`, `data/datatables-${LANG}.json`, `./data/marker.json`];
const glot = new Glottologist();

// initialize
console.log("Welcome to MapMaker.");
window.addEventListener("DOMContentLoaded", function () {
	let jqXHRs = [];
	for (let key in FILES) { jqXHRs.push($.get(FILES[key])) };
	$.when.apply($, jqXHRs).always(function () {
		let arg = {}, baselist = arguments[0][0];								// Get Menu HTML
		for (let i = 1; i <= 6; i++) arg = Object.assign(arg, arguments[i][0]);	// Make Config Object
		Object.keys(arg).forEach(key1 => {
			Conf[key1] = {};
			Object.keys(arg[key1]).forEach((key2) => Conf[key1][key2] = arg[key1][key2]);
		});

		window.onresize = winCont.window_resize;      	// 画面サイズに合わせたコンテンツ表示切り替え
		glot.import("./data/glot.json").then(() => {	// Multi-language support
			// document.title = glot.get("title");		// Title(no change / Google検索で日本語表示させたいので)
			cMapmaker.init(baselist);					// Mapmaker Initialize
			if (Conf.google.Analytics !== "") {			// Google Analytics
				let AnalyticsURL = '<script async src="https://www.googletagmanager.com/gtag/js?id=' + Conf.default.GoogleAnalytics + '"></script>';
				document.getElementsByTagName('head').insertAdjacentHTML("beforeend", AnalyticsURL);
				window.dataLayer = window.dataLayer || [];
				function gtag() { dataLayer.push(arguments); };
				gtag('js', new Date());
				gtag('config', Conf.google.Analytics);
			};
		});
	});
});

class CMapMaker {

	constructor() {
		this.status = "initialize";
		this.open_osmid = "";
		this.last_modetime = 0;
	};

	init(baselist) {	// Initialize
		winCont.window_resize();			// Set Window Size(mapidのサイズ指定が目的)
		winCont.splash(true);
		Marker.init();						// Marker Initialize
		leaflet.init();						// Leaflet Initialize

		Promise.all([
			gSpreadSheet.get(Conf.google.AppScript, Conf.google.sheetName),
			cMapmaker.poi_get(),			// get_zoomなどleafletの情報が必要なためleaflet.init後に実行
			cMapmaker.static_check()
		]).then(results => {
			leaflet.controlAdd("bottomleft", "zoomlevel", "");
			leaflet.controlAdd("topleft", "baselist", baselist, "leaflet-control m-1");	// Make: base list
			leaflet.controlAdd("bottomright", "global_spinner", "", "spinner-border text-primary d-none");
			leaflet.locateAdd();
			$("#dataid").hover(
				() => { map.scrollWheelZoom.disable(); map.dragging.disable() },
				() => { map.scrollWheelZoom.enable(); map.dragging.enable() }
			);
			poiCont.set_actjson(results[0]);
			cmap_events.init();
			cMapmaker.poi_view();
			winCont.window_resize();
			listTable.init();
			listTable.datalist_make(Object.values(Conf.targets));						// view all list
			cMapmaker.mode_change("map");												// initialize last_modetime
			winCont.menu_make(Conf.menu, "main_menu");
			glot.render();
			if (location.search !== "") {    	// 引数がある場合
				let search = location.search.replace(/[?&]fbclid.*/, '').replace(/%2F/g, '/');   // facebook対策
				let param = search.replace('-', '/').replace('=', '/').slice(1).split('.');
				history.replaceState('', '', location.pathname + search + location.hash);
				if (param[0] !== "") {
					cMapmaker.detail_view(param[0], param[1]);
				};
			};
			winCont.splash(false);
			console.log("cmapmaker: initial end.");
		});
	}

	static_check() {	// check static osm mode
		return new Promise((resolve, reject) => {
			if (Conf.static.osmjson == "") {
				resolve();
			} else {
				$.ajax({ "type": 'GET', "dataType": 'json', "url": Conf.static.osmjson, "cache": false }).done(function (data) {
					OvPassCnt.set_osmjson(data);
					resolve();
				}).fail(function (jqXHR, statusText, errorThrown) {
					console.log(statusText);
					reject(jqXHR, statusText, errorThrown);
				});;
			}
		})
	}

	licence() {			// About license
		let msg = { msg: glot.get("licence_message") + glot.get("more_message"), ttl: glot.get("licence_title") };
		winCont.modal_open({ "title": msg.ttl, "message": msg.msg, "mode": "close", callback_close: winCont.modal_close, "menu": false });
	}

	mode_change(mode) {	// mode change(list or map)
		if (this.status !== "mode_change" && (this.last_modetime + 300) < Date.now()) {
			this.status = "mode_change";
			let params = { 'map': ['down', 'remove', 'start'], 'list': ['up', 'add', 'stop'] };
			mode = !mode ? (list_collapse.classList.contains('show') ? 'map' : 'list') : mode;
			console.log('mode_change: ' + mode + ' : ' + this.last_modetime + " : " + Date.now());
			list_collapse_icon.className = 'fas fa-chevron-' + params[mode][0];
			list_collapse.classList[params[mode][1]]('show');
			//			if (mode == "list") {
			//				listTable.datalist_make(Object.values(Conf.targets))
			//			};
			this.last_modetime = Date.now();
			this.status = "normal";
		};
	}

	poi_view() {			// Poiを表示させる
		console.log("cMapmaker: PoiView");
		if (map.getZoom() >= Conf.default.iconViewZoom) {
			Object.values(Conf.targets).forEach(key => Marker.set(key));
		} else {
			Marker.all_clear();
		};
	}

	poi_get(targets) {		// OSMとGoogle SpreadSheetからPoiを取得してリスト化
		return new Promise((resolve, reject) => {
			console.log("cMapmaker: PoiGet start");
			winCont.spinner(true);
			var keys = (targets !== undefined && targets !== "") ? targets : Object.values(Conf.targets);
			if (map.getZoom() < Conf.default.iconViewZoom) {
				winCont.spinner(false);
				console.log("cMapmaker: poi_get end(more zoom).");
				resolve({ "update": false });
			} else {
				OvPassCnt.get(keys).then(ovanswer => {
					winCont.spinner(false);
					poiCont.all_clear();
					poiCont.add_geojson(ovanswer);
					console.log("cMapmaker: poi_get end(success).");
					resolve({ "update": true });
				}) /* .catch((jqXHR, statusText, errorThrown) => {
					winCont.spinner(false);
					console.log("cMapmaker: poi_get end(overror). " + statusText);
					// cMapmaker.update();
					reject();
				}); */
			};
		});
	}

	qr_add(target, osmid) {			// QRコードを表示
		let marker = Marker.get(target, osmid);
		if (marker !== undefined) {
			let wiki = marker.mapmaker_lang.split(':');
			let url = encodeURI(`https://${wiki[0]}.${Conf.osm.wikipedia.domain}/wiki/${wiki[1]}`);
			let pix = map.latLngToLayerPoint(marker.getLatLng());
			let ll2 = map.layerPointToLatLng(pix);
			basic.getWikipedia(wiki[0], wiki[1]).then(text => Marker.qr_add(target, osmid, url, ll2, text));
		};
	}

	detail_view(osmid, openid) {	// PopUpを表示(marker,openid=actlst.id)
		let osmobj = poiCont.get_osmid(osmid);
		let tags = osmobj == undefined ? { "targets": [] } : osmobj.geojson.properties;
		let micon = tags.mapmaker_icon;
		let target = osmobj.targets[0];
		let category = poiCont.get_catname(tags);
		let title = "", message = "";
		for (let i = 0; i < Conf.osm[target].views.length; i++) {
			if (tags[Conf.osm[target].views[i]] !== void 0) {
				title = `<img src="./image/${micon}">${tags[Conf.osm[target].views[i]]}`;
				break;
			}
		}
		if (title == "") title = category;
		if (title == "") title = glot.get("undefined");
		winCont.menu_make(Conf.detail_menu, "modal_menu");
		winCont.modal_progress(0);
		cMapmaker.open_osmid = osmid;

		// append OSM Tags(仮…テイクアウトなど判別した上で最終的には分ける)
		message += modal_osmbasic.make(tags);

		// append wikipedia
		if (tags.wikipedia !== undefined) {
			message += modal_wikipedia.element();
			winCont.modal_progress(100);
			modal_wikipedia.make(tags).then(html => {
				modal_wikipedia.set_dom(html);
				winCont.modal_progress(0);
			});
		};

		// append activity
		let actlists = poiCont.get_actlist(osmid);
		if (actlists.length > 0) message += modal_activities.make(actlists, openid);
		history.replaceState('', '', location.pathname + "?" + osmid + (!openid ? "" : "." + openid) + location.hash);
		winCont.modal_open({
			"title": title, "message": message, "mode": "close", "callback_close": () => {
				winCont.modal_close();
				history.replaceState('', '', location.pathname + location.hash);
				cMapmaker.open_osmid = "";
			}, "menu": true
		});
		if (openid !== undefined) document.getElementById("modal_" + openid).scrollIntoView();

		$('[data-toggle="popover"]').popover();			// set PopUp
	}

	url_share(openid) {			// URL共有機能
		function execCopy(string) {
			let pre = document.createElement('pre');			// ClipBord Copy
			pre.style.webkitUserSelect = 'auto';
			pre.style.userSelect = 'auto';
			let text = document.createElement("div");
			text.appendChild(pre).textContent = string;
			text.style.position = 'fixed';
			text.style.right = '200%';
			document.body.appendChild(text);
			document.getSelection().selectAllChildren(text);
			let copy = document.execCommand("copy");
			document.body.removeChild(text);
			return copy;
		};
		let osmid = location.search.replace(/[?&]fbclid.*/, '');    // facebook対策
		let param = osmid.replace('-', '%2F').replace('=', '%2F').slice(1).split('.');
		execCopy(location.protocol + "//" + location.hostname + location.pathname + "?" + param[0] + (!openid ? "" : "." + openid) + location.hash);
	}
};
var cMapmaker = new CMapMaker();

class cMapEvents {

	constructor() {
		this.busy = false;
		this.id = 0;
	}

	init() {
		map.on('moveend', () => cmap_events.map_move());   	// マップ移動時の処理
		map.on('zoomend', () => cmap_events.map_zoom());	// ズーム終了時に表示更新
	}

	map_move(e) {                					// map.moveend発生時のイベント
		console.log("cmapmaker: move event start.");
		if (this.busy > 1) return;					// 処理中の時は戻る
		if (this.busy == 1) clearTimeout(this.id);	// no break and cancel old timer.
		this.busy = 1;
		this.id = setTimeout(() => {
			console.log("cmapmaker: move event end.");
			this.busy = 2;
			cMapmaker.poi_get().then((status) => {
				cMapmaker.poi_view();
				if (status.update) listTable.datalist_make(Object.values(Conf.targets));	// view all list
				this.busy = 0;
			});
		}, 1000);
	}

	map_zoom() {				// View Zoom Level & Status Comment
		let nowzoom = map.getZoom();
		let message = `${glot.get("zoomlevel")}${map.getZoom()} `;
		if (nowzoom < Conf.default.iconViewZoom) message += `<br>${glot.get("morezoom")}`;
		$("#zoomlevel").html("<h2 class='zoom'>" + message + "</h2>");
	}
}
var cmap_events = new cMapEvents();

class Activity {

	constructor() {
		this.busy = false;
	};

	// edit activity
	edit(id) {			// p {id: undefined時はnew}
		let title = glot.get(id === void 0 ? "act_add" : "act_edit");
		let gt = {};
		["category", "name", "rubi", "memo", "detail_url", "official_url", "picture_url1", "picture_url2", "picture_url3"]
			.forEach(key => { gt[`act_${key}`] = glot.get(`act_${key}`) });

		let message = `
		<div class="container">
			<div class="row mb-1 align-items-center">
				<div class="col-2 p-1">${gt.act_category}</div>
				<div class="col-10 p-1"><input type="text" id="act_category" class="form-control form-control-sm"></input></div>
			</div>
			<div class="row mb-1 align-items-center">
				<div class="col-2 p-1">${gt.act_name}</div>
				<div class="col-10 p-1"><input type="text" id="act_name" maxlength="40" class="form-control form-control-sm"></div>
			</div>
			<div class="row mb-1 align-items-center">
				<div class="col-2 p-1">${gt.act_rubi}</div>
				<div class="col-10 p-1"><input type="text" id="act_rubi" maxlength="40" class="form-control form-control-sm"></div>
			</div>
			<div class="row mb-1 align-items-center">
				<div class="col-2 p-1">${gt.act_memo}</div>
				<div class="col-10 p-1"><textarea id="act_memo" rows="8" class="form-control form-control-sm"></textarea></div>
			</div>
			<div class="row mb-1 align-items-center">
				<div class="col-2 p-1">${gt.act_detail_url}</div>
				<div class="col-10 p-1"><input type="url" id="act_detail_url" class="form-control form-control-sm"></div>
			</div>
			<div class="row mb-1 align-items-center">
				<div class="col-2 p-1">${gt.act_official_url}</div>
				<div class="col-10 p-1"><input type="url" id="act_official_url" class="form-control form-control-sm"></div>
			</div>
			<div class="row mb-1 align-items-center">
				<div class="col-2 p-1">${gt.act_picture_url1}</div>
				<div class="col-10 p-1"><input type="url" id="act_picture_url1" value="https://" class="form-control form-control-sm"></div>
			</div>
			<div class="row mb-1 align-items-center">
				<div class="col-2 p-1">${gt.act_picture_url2}</div>
				<div class="col-10 p-1"><input type="url" id="act_picture_url2" value="https://" class="form-control form-control-sm"></div>
			</div>
			<div class="row mb-1 align-items-center">
				<div class="col-2 p-1">${gt.act_picture_url3}</div>
				<div class="col-10 p-1"><input type="url" id="act_picture_url3" value="https://" class="form-control form-control-sm"></div>
				<input type="hidden" id="act_id" value="${id === void 0 ? "" : id}"></input>
				<input type="hidden" id="act_osmid" value="${cMapmaker.open_osmid}"></input>
			</div>
			<div class="row mb-1 align-items-center">
				<div class="col-12 p-1"><h4>この内容で登録しますか？</h4></div>
			</div>
		</div>
		`;

		winCont.modal_progress(0);
		winCont.modal_open({
			"title": title, "message": message, "mode": "yes,no", "menu": true,
			"callback_no": () => { winCont.modal_close() }, "callback_yes": () => {
				if (!activity.busy) {
					activity.busy = true;
					let senddata = {
						"id": act_id.value, "osmid": act_osmid.value, "category": act_category.value, "title": act_name.value, "rubi": act_rubi.value,
						"body": act_memo.value, "detail_url": act_detail_url.value, "official_url": act_official_url.value,
						"picture_url1": act_picture_url1.value, "picture_url2": act_picture_url2.value, "picture_url3": act_picture_url3.value
					};
					gSpreadSheet.set(Conf.google.AppScript, Conf.google.sheetName, senddata, "child").then(() => {
						console.log("save");
						winCont.modal_close();
						gSpreadSheet.get(Conf.google.AppScript, Conf.google.sheetName).then(jsonp => {
							poiCont.set_actjson(jsonp);
							cMapmaker.poi_view();
							activity.busy = false;
						});
					}).catch(() => {
						activity.busy = false;
					});
				}
			}
		});
	}

	// Google Spreadsheet Control Form
	form_edit(json) {
		listTable.select(json['OSMID']);
		$("#osmid").html(json['OSMID']);
		$("#area").val(json['場所']);
		$("#planting").val(formatDate(new Date(json['植樹日']), "YYYY-MM-DD"));
		$("#name").val(json['愛称']);
		$("#picture_url").val(json['写真アドレス']);

		let picurl = json['写真アドレス'];
		let pattern = new RegExp('^(https?:\\/\\/)?((([a-z\\d]([a-z\\d-]*[a-z\\d])*)\\.)+[a-z]{2,}|((\\d{1,3}\\.){3}\\d{1,3}))(\\:\\d+)?(\\/[-a-z\\d%_.~+]*)*(\\?[;&a-z\\d%_.~+=-]*)?(\\#[-a-z\\d_]*)?$', 'i');
		if (pattern.test(picurl) && picurl !== "") {
			console.log("picture url is valid");
			$("#picture_img").attr('src', picurl);
			$("#picture_img").show();
		} else {
			console.log("picture url is invalid");
			$("#picture_img").attr('src', "");
			$("#picture_img").hide();
		};
		$("#memo").val(json['メモ']);
		$('#PoiEdit_Modal').modal({ backdrop: false, keyboard: false });
	};
};
var activity = new Activity();	// Google Spreadsheet Control Form
