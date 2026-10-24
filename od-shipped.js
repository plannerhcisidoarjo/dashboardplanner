/* ==========================================================================
   TOTAL OD SHIPPED & HUB TRANSIT EXECUTIVE ANALYTICS ENGINE
   Sources:
   - Data H6       (OD Regular)
   - Data Hub      (Hub Transit - Store / GRW / Flow Thru)
   - Data Hub Cust (Hub Transit - Customer)
   Spreadsheet: 1JlM0Ry0V0XPvuq7NvO50WOR13-jYGWUR1Xc66wRY1cY
   ========================================================================== */

(function () {
  'use strict';

  var SPREADSHEET_ID = '1JlM0Ry0V0XPvuq7NvO50WOR13-jYGWUR1Xc66wRY1cY';
  var SPREADSHEET_EDIT_URL =
    'https://docs.google.com/spreadsheets/d/' + SPREADSHEET_ID + '/edit?usp=sharing';

  var MONTH_NAMES_ID = [
    'Januari',
    'Februari',
    'Maret',
    'April',
    'Mei',
    'Juni',
    'Juli',
    'Agustus',
    'September',
    'Oktober',
    'November',
    'Desember',
  ];
  var MONTH_SHORT_ID = [
    'Jan',
    'Feb',
    'Mar',
    'Apr',
    'Mei',
    'Jun',
    'Jul',
    'Agu',
    'Sep',
    'Okt',
    'Nov',
    'Des',
  ];
  var DOW_NAMES_ID = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];
  var DOW_ORDER_MON_FIRST = [1, 2, 3, 4, 5, 6, 0];

  var ODS_STATE = {
    cube: null,
    loading: false,
    error: null,
    uiMounted: false,

    // Active Filters
    stream: 'ALL', // ALL | REGULAR | HUB_ALL | HUB_GRW | HUB_CUST
    startDate: '',
    endDate: '',
    preset: 'ALL',
    month: 'ALL', // ALL | YYYY-MM
    area: 'ALL', // ALL | DK | LK
    category: 'ALL',
    wilayah: 'ALL',
    metric: 'CBM', // CBM | OD
    monthlySeries: 'ALL', // ALL | REGULAR | HUB

    // Sub-tab & Daily Table Controls
    activeTab: 'monthly', // monthly | category | daily | regional
    dailySearch: '',
    dailyDayType: 'ALL', // ALL | WEEKDAY | WEEKEND | PEAK
    dailySortCol: 'date',
    dailySortDir: -1, // newest first by default
    dailyPage: 1,
    dailyPageSize: 31,

    catSortCol: 'orders',
    catSortDir: -1,

    // Cached Computed Result for Export / Table Pagination
    lastComputed: null,
  };

  var charts = {
    monthly: null,
    category: null,
    dow: null,
    daily: null,
  };

  function fmtInt(n) {
    return Math.round(Number(n) || 0).toLocaleString('id-ID');
  }

  function fmtDec(n, digits) {
    var d = digits === undefined ? 2 : digits;
    return (Number(n) || 0).toLocaleString('id-ID', {
      minimumFractionDigits: d,
      maximumFractionDigits: d,
    });
  }

  function fmtPct(n, digits) {
    var d = digits === undefined ? 1 : digits;
    return fmtDec(n, d) + '%';
  }

  function escHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function formatIsoToIdShort(iso) {
    if (!iso) return '—';
    var p = iso.split('-');
    if (p.length !== 3) return iso;
    var mIdx = parseInt(p[1], 10) - 1;
    return parseInt(p[2], 10) + ' ' + (MONTH_SHORT_ID[mIdx] || p[1]) + ' ' + p[0];
  }

  function formatYmLabel(ym) {
    if (!ym) return '—';
    var p = ym.split('-');
    if (p.length !== 2) return ym;
    var mIdx = parseInt(p[1], 10) - 1;
    return (MONTH_NAMES_ID[mIdx] || p[1]) + ' ' + p[0];
  }

  function formatYmShort(ym) {
    if (!ym) return '—';
    var p = ym.split('-');
    if (p.length !== 2) return ym;
    var mIdx = parseInt(p[1], 10) - 1;
    return (MONTH_SHORT_ID[mIdx] || p[1]) + ' ' + p[0].slice(2);
  }

  function getDowIndexFromIso(iso) {
    var p = iso.split('-');
    var d = new Date(parseInt(p[0], 10), parseInt(p[1], 10) - 1, parseInt(p[2], 10));
    return d.getDay();
  }

  // Fallback client-side builder if /api/od-shipped is unavailable (e.g. static hosting)
  function fetchDirectFallbackCube() {
    var tabSpecs = [
      { gid: '1349733087', name: 'Data H6' },
      { gid: '1183334793', name: 'Data Hub' },
      { gid: '1472051669', name: 'Data Hub Cust' },
      { gid: '736235751', name: 'MASTER SITE' },
    ];

    function fetchTabRows(spec) {
      var gvizUrl =
        'https://docs.google.com/spreadsheets/d/' +
        SPREADSHEET_ID +
        '/gviz/tq?tqx=out:csv&gid=' +
        spec.gid;
      var exportUrl =
        'https://docs.google.com/spreadsheets/d/' +
        SPREADSHEET_ID +
        '/export?format=csv&gid=' +
        spec.gid;

      var primary = typeof window.getProxyUrl === 'function' ? window.getProxyUrl(gvizUrl) : gvizUrl;
      var secondary = typeof window.getProxyUrl === 'function' ? window.getProxyUrl(exportUrl) : exportUrl;

      return new Promise(function (resolve) {
        if (typeof window.fetchAndParseCsv === 'function') {
          window.fetchAndParseCsv(primary, { header: false, skipEmptyLines: true }, function (rows) {
            if (rows && rows.length > 1) {
              resolve(rows);
            } else {
              window.fetchAndParseCsv(secondary, { header: false, skipEmptyLines: true }, function (rows2) {
                resolve(rows2 || []);
              });
            }
          });
          return;
        }
        fetch(primary)
          .then(function (r) {
            if (!r.ok) throw new Error('HTTP ' + r.status);
            return r.text();
          })
          .then(function (txt) {
            var parsed = window.Papa.parse(txt, { header: false, skipEmptyLines: true });
            resolve(parsed.data || []);
          })
          .catch(function () {
            fetch(secondary)
              .then(function (r) { return r.text(); })
              .then(function (txt) {
                var parsed = window.Papa.parse(txt, { header: false, skipEmptyLines: true });
                resolve(parsed.data || []);
              })
              .catch(function () {
                resolve([]);
              });
          });
      });
    }

    return Promise.all(tabSpecs.map(fetchTabRows)).then(function (resArr) {
      return buildClientCubeFromRawRows(resArr[0], resArr[1], resArr[2], resArr[3]);
    });
  }

  function parseToIsoClient(raw) {
    var s = String(raw || '').trim().split(' ')[0];
    if (!s) return null;
    if (/^\d{4}-\d{1,2}-\d{1,2}$/.test(s)) {
      var a = s.split('-');
      return (
        a[0] +
        '-' +
        String(parseInt(a[1], 10)).padStart(2, '0') +
        '-' +
        String(parseInt(a[2], 10)).padStart(2, '0')
      );
    }
    var p = s.split('/');
    if (p.length === 3) {
      var p0 = parseInt(p[0], 10),
        p1 = parseInt(p[1], 10),
        y = parseInt(p[2], 10);
      if (isNaN(p0) || isNaN(p1) || isNaN(y)) return null;
      if (y < 100) y += 2000;
      var m = p0 > 12 ? p1 : p0;
      var d = p0 > 12 ? p0 : p1;
      if (y >= 2020 && m >= 1 && m <= 12 && d >= 1 && d <= 31) {
        return y + '-' + String(m).padStart(2, '0') + '-' + String(d).padStart(2, '0');
      }
    }
    return null;
  }

  function findColIdx(headerRow, candidates) {
    if (!headerRow || !headerRow.length) return -1;
    var norm = headerRow.map(function (h) {
      return String(h || '').trim().toLowerCase().replace(/[\s_]+/g, ' ');
    });
    for (var i = 0; i < candidates.length; i++) {
      var target = candidates[i].toLowerCase().replace(/[\s_]+/g, ' ');
      var idx = norm.indexOf(target);
      if (idx !== -1) return idx;
    }
    return -1;
  }

  function buildClientCubeFromRawRows(h6Rows, hubRows, hubCustRows, masterSiteRows) {
    var siteKotaMap = {};
    if (masterSiteRows && masterSiteRows.length > 1) {
      var mh = masterSiteRows[0];
      var iKode = findColIdx(mh, ['ST KODE', 'KODE']);
      var iKota = findColIdx(mh, ['KOTA', 'WILAYAH']);
      for (var ms = 1; ms < masterSiteRows.length; ms++) {
        var mRow = masterSiteRows[ms];
        var kode = String(mRow[iKode >= 0 ? iKode : 0] || '').trim().toUpperCase();
        var kota = String(mRow[iKota >= 0 ? iKota : 2] || '').trim().toUpperCase();
        if (kode && kota) siteKotaMap[kode] = kota;
      }
    }

    var dateSet = {};
    var catList = [],
      catMap = {};
    var macroList = [],
      macroMap = {};
    var areaList = ['DK', 'LK'],
      areaMap = { DK: 0, LK: 1 };
    var wilList = [],
      wilMap = {};
    var origList = [],
      origMap = {};
    var buckets = {};

    function idxOf(map, list, val) {
      if (map[val] === undefined) {
        map[val] = list.length;
        list.push(val);
      }
      return map[val];
    }

    function macroOf(c) {
      var u = c.toUpperCase();
      if (u.indexOf('ECOMMERCE') !== -1) return 'E-Commerce';
      if (u.indexOf('TUGU') !== -1) return 'Tugu';
      if (u.indexOf('CUSTOMER') !== -1) return 'Customer Delivery';
      if (u.indexOf('GRW') !== -1 || u.indexOf('FLOW THRU') !== -1)
        return 'Store & Hub Replenishment (GRW)';
      return 'SAP / Internal / Damage';
    }

    function cleanWil(w, siteCodeFallback, cityFallback) {
      var v = String(w || '').trim().toUpperCase().replace(/\s+/g, ' ');
      if (!v || v === '#N/A' || v === 'N/A' || v === '-') {
        var sc = String(siteCodeFallback || '').trim().toUpperCase();
        if (sc && siteKotaMap[sc]) v = siteKotaMap[sc];
        else if (cityFallback) v = String(cityFallback).trim().toUpperCase().replace(/\s+/g, ' ');
      }
      if (!v || v === '#N/A' || v === 'N/A' || v === '-') return 'LAINNYA';
      return v === 'LOMBK' ? 'LOMBOK' : v;
    }

    function normArea(a) {
      var u = String(a || '').trim().toUpperCase();
      return u === 'DK' || u.indexOf('DALAM KOTA') !== -1 ? 'DK' : 'LK';
    }

    function addRec(dIso, sIdx, cat, area, wil, orig, ord, cbm, onT, del, lt) {
      dateSet[dIso] = true;
      var cI = idxOf(catMap, catList, cat);
      var mI = idxOf(macroMap, macroList, macroOf(cat));
      var aI = idxOf(areaMap, areaList, normArea(area));
      var wI = idxOf(wilMap, wilList, wil);
      var oI = idxOf(origMap, origList, orig);
      var k = dIso + '|' + sIdx + '|' + cI + '|' + aI + '|' + wI + '|' + oI;
      if (!buckets[k]) {
        buckets[k] = [dIso, sIdx, cI, mI, aI, wI, oI, 0, 0, 0, 0, 0, 0];
      }
      var b = buckets[k];
      b[7] += ord;
      b[8] += cbm;
      b[9] += onT;
      b[10] += del;
      if (lt !== null && !isNaN(lt) && lt >= 0) {
        b[11] += lt;
        b[12] += 1;
      }
    }

    var validH6 = 0;
    if (h6Rows && h6Rows.length > 1) {
      var h6h = h6Rows[0];
      var iH6ShipTo = findColIdx(h6h, ['Ship to']);
      var iH6City = findColIdx(h6h, ['City']);
      var iH6Type = findColIdx(h6h, ['Type Order', 'Type']);
      var iH6Area = findColIdx(h6h, ['Area']);
      var iH6Ord = findColIdx(h6h, ['Total Order', 'Order']);
      var iH6Cbm = findColIdx(h6h, ['CBM', 'Cube']);
      var iH6Date = findColIdx(h6h, ['Periode', 'Date', 'Tanggal']);
      var iH6Dc = findColIdx(h6h, ['DC Name']);
      var iH6Wil = findColIdx(h6h, ['Wilayah']);

      for (var i = 1; i < h6Rows.length; i++) {
        var r = h6Rows[i];
        var d = parseToIsoClient(r[iH6Date >= 0 ? iH6Date : 8]);
        if (!d) continue;
        var ordVal = parseFloat(String(r[iH6Ord >= 0 ? iH6Ord : 6] || '0').replace(/,/g, '')) || 0;
        var cbmVal = parseFloat(String(r[iH6Cbm >= 0 ? iH6Cbm : 7] || '0').replace(/,/g, '')) || 0;
        if (ordVal <= 0 && cbmVal <= 0) continue;
        validH6++;
        addRec(
          d,
          0,
          String(r[iH6Type >= 0 ? iH6Type : 4] || 'Regular Lainnya').trim() || 'Regular Lainnya',
          r[iH6Area >= 0 ? iH6Area : 5],
          cleanWil(r[iH6Wil >= 0 ? iH6Wil : 11], iH6ShipTo >= 0 ? r[iH6ShipTo] : '', iH6City >= 0 ? r[iH6City] : ''),
          String(r[iH6Dc >= 0 ? iH6Dc : 9] || 'DC SIDOARJO').trim().toUpperCase(),
          ordVal,
          cbmVal,
          0,
          0,
          null
        );
      }
    }

    var validHub = 0;
    if (hubRows && hubRows.length > 1) {
      var hh = hubRows[0];
      var iHubShipTo = findColIdx(hh, ['SHIP TO']);
      var iHubOk = findColIdx(hh, ['ORDERKEY']);
      var iHubArea = findColIdx(hh, ['AREA']);
      var iHubType = findColIdx(hh, ['TYPE']);
      var iHubActual = findColIdx(hh, ['ACTUAL SHIPDATE', 'SHIPPED DATE']);
      var iHubReq = findColIdx(hh, ['REQUESTED SHIPDATE']);
      var iHubOrdDate = findColIdx(hh, ['ORDERDATE']);
      var iHubLt = findColIdx(hh, ['LEAD TIME']);
      var iHubAch = findColIdx(hh, ['ACHIEVEMENT']);
      var iHubCube = findColIdx(hh, ['CUBE', 'CBM']);
      var iHubWil = findColIdx(hh, ['WILAYAH']);
      var seenHubKeys = {};

      for (var j = 1; j < hubRows.length; j++) {
        var rh = hubRows[j];
        var okKey = iHubOk >= 0 ? String(rh[iHubOk] || '').trim() : '';
        if (okKey) {
          if (seenHubKeys[okKey]) continue;
          seenHubKeys[okKey] = true;
        }
        var dh =
          parseToIsoClient(iHubActual >= 0 ? rh[iHubActual] : rh[18]) ||
          parseToIsoClient(iHubReq >= 0 ? rh[iHubReq] : '') ||
          parseToIsoClient(iHubOrdDate >= 0 ? rh[iHubOrdDate] : '');
        if (!dh) continue;
        var rawHubType = String(rh[iHubType >= 0 ? iHubType : 11] || 'GRW').trim();
        var hubCat = rawHubType.toUpperCase().indexOf('HUB') === 0 ? rawHubType : 'Hub Transit - ' + rawHubType;
        var ach = String(rh[iHubAch >= 0 ? iHubAch : 24] || '').trim().toUpperCase();
        var ltStr = String(rh[iHubLt >= 0 ? iHubLt : 22] || '').trim();
        var ltRaw = ltStr !== '' ? parseFloat(ltStr) : NaN;
        validHub++;
        addRec(
          dh,
          1,
          hubCat,
          rh[iHubArea >= 0 ? iHubArea : 7],
          cleanWil(rh[iHubWil >= 0 ? iHubWil : 27], iHubShipTo >= 0 ? rh[iHubShipTo] : '', ''),
          'HUB TRANSIT (STORE/GRW)',
          1,
          parseFloat(String(rh[iHubCube >= 0 ? iHubCube : 25] || '0').replace(/,/g, '')) || 0,
          ach === 'ON TIME' ? 1 : 0,
          ach && ach !== 'ON TIME' ? 1 : 0,
          isNaN(ltRaw) ? null : ltRaw
        );
      }
    }

    var validHubCust = 0;
    if (hubCustRows && hubCustRows.length > 1) {
      var hch = hubCustRows[0];
      var iHcOk = findColIdx(hch, ['ORDERKEY']);
      var iHcType = findColIdx(hch, ['TYPE']);
      var iHcBook = findColIdx(hch, ['BOOKING SITE']);
      var iHcShip = findColIdx(hch, ['SHIPPED DATE']);
      var iHcRef = findColIdx(hch, ['REFERENCE DATE']);
      var iHcAdd = findColIdx(hch, ['ADD DATE']);
      var iHcSla = findColIdx(hch, ['SLA CATEGORY']);
      var iHcArea = findColIdx(hch, ['AREA PENGIRIMAN', 'AREA']);
      var iHcCity = findColIdx(hch, ['CITY']);
      var iHcCbm = findColIdx(hch, ['CBM', 'CUBE']);
      var iHcKode = findColIdx(hch, ['KODE STORE']);
      var iHcWil = findColIdx(hch, ['WILAYAH']);
      var seenHcKeys = {};

      for (var k = 1; k < hubCustRows.length; k++) {
        var rc = hubCustRows[k];
        var hcKey = iHcOk >= 0 ? String(rc[iHcOk] || '').trim() : '';
        if (hcKey) {
          if (seenHcKeys[hcKey]) continue;
          seenHcKeys[hcKey] = true;
        }
        var dc =
          parseToIsoClient(iHcShip >= 0 ? rc[iHcShip] : rc[12]) ||
          parseToIsoClient(iHcRef >= 0 ? rc[iHcRef] : '') ||
          parseToIsoClient(iHcAdd >= 0 ? rc[iHcAdd] : '');
        if (!dc) continue;
        var rawHcType = String(rc[iHcType >= 0 ? iHcType : 4] || 'HUB-Customer').trim();
        var hcCat = rawHcType === 'HUB-Customer' ? 'Hub Transit - Customer' : rawHcType;
        var sla = String(rc[iHcSla >= 0 ? iHcSla : 14] || '').trim().toUpperCase();
        validHubCust++;
        addRec(
          dc,
          2,
          hcCat,
          rc[iHcArea >= 0 ? iHcArea : 15],
          cleanWil(
            rc[iHcWil >= 0 ? iHcWil : 25],
            iHcKode >= 0 ? rc[iHcKode] : '',
            iHcCity >= 0 ? rc[iHcCity] : ''
          ),
          String(rc[iHcBook >= 0 ? iHcBook : 6] || 'ORIGIN LAINNYA').trim().toUpperCase(),
          1,
          parseFloat(String(rc[iHcCbm >= 0 ? iHcCbm : 18] || '0').replace(/,/g, '')) || 0,
          sla === 'ON TIME' ? 1 : 0,
          sla && sla !== 'ON TIME' ? 1 : 0,
          null
        );
      }
    }

    var dates = Object.keys(dateSet).sort();
    var dLookup = {};
    dates.forEach(function (dt, idx) {
      dLookup[dt] = idx;
    });
    var tuples = Object.keys(buckets).map(function (key) {
      var b = buckets[key];
      b[0] = dLookup[b[0]];
      b[7] = Math.round(b[7]);
      b[8] = Math.round(b[8] * 100) / 100;
      b[11] = Math.round(b[11] * 10) / 10;
      return b;
    });

    return {
      updatedAt: new Date().toISOString(),
      spreadsheetUrl: SPREADSHEET_EDIT_URL,
      rowCounts: {
        h6Rows: validH6,
        hubRows: validHub,
        hubCustRows: validHubCust,
      },
      dicts: {
        dates: dates,
        sheets: ['Data H6', 'Data Hub', 'Data Hub Cust'],
        categories: catList,
        macroGroups: macroList,
        areas: areaList,
        wilayahs: wilList,
        origins: origList,
      },
      tuples: tuples,
    };
  }

  function loadOdShippedDataset(forceRefresh) {
    if (ODS_STATE.loading) return;
    if (ODS_STATE.cube && !forceRefresh) {
      renderOdShippedView();
      return;
    }

    ODS_STATE.loading = true;
    ODS_STATE.error = null;
    renderLoadingOrErrorState();

    var host = (window.location.hostname || '').toLowerCase();
    var isStaticHost =
      host.indexOf('github.io') !== -1 ||
      window.location.protocol === 'file:' ||
      !host;

    var dataPromise = isStaticHost
      ? fetchDirectFallbackCube()
      : fetch('/api/od-shipped' + (forceRefresh ? '?refresh=1' : ''))
          .then(function (res) {
            if (!res.ok) throw new Error('HTTP ' + res.status);
            var ct = res.headers.get('content-type') || '';
            if (ct.indexOf('application/json') === -1) {
              throw new Error('Non-JSON response');
            }
            return res.json();
          })
          .catch(function (err) {
            console.warn('[OD Shipped] Backend endpoint fallback ke direct CSV:', err.message);
            return fetchDirectFallbackCube();
          });

    dataPromise
      .then(function (cube) {
        ODS_STATE.cube = cube;
        ODS_STATE.loading = false;
        ODS_STATE.error = null;

        if (cube.dicts.dates.length > 0 && (!ODS_STATE.startDate || !ODS_STATE.endDate)) {
          ODS_STATE.startDate = cube.dicts.dates[0];
          ODS_STATE.endDate = cube.dicts.dates[cube.dicts.dates.length - 1];
        }

        mountOdShippedShell();
        populateDynamicSelects();
        syncFilterControls();
        recomputeAndRender();
      })
      .catch(function (err) {
        ODS_STATE.loading = false;
        ODS_STATE.error = err ? err.message : 'Gagal memuat data spreadsheet.';
        renderLoadingOrErrorState();
      });
  }

  function renderLoadingOrErrorState() {
    var root = document.getElementById('pg-od-shipped');
    if (!root) return;
    ODS_STATE.uiMounted = false;

    if (ODS_STATE.loading) {
      root.innerHTML =
        '<div class="ods-state-box">' +
        '  <div class="ods-spinner"></div>' +
        '  <div style="font-size:15px;font-weight:700;">Memuat &amp; Mengonsolidasi Data OD Shipped…</div>' +
        '  <div style="font-size:12.5px;max-width:480px;">Menarik data aktual dari sheet <strong>Data H6</strong> (OD Regular), <strong>Data Hub</strong> (Hub Transit Store/GRW), dan <strong>Data Hub Cust</strong> (Hub Transit Customer).</div>' +
        '</div>';
    } else if (ODS_STATE.error) {
      root.innerHTML =
        '<div class="ods-state-box">' +
        '  <div style="font-size:15px;font-weight:700;color:#dc2626;">Gagal Memuat Data OD Shipped</div>' +
        '  <div style="font-size:12.5px;">' +
        escHtml(ODS_STATE.error) +
        '</div>' +
        '  <button class="ods-btn ods-btn-primary" onclick="window.odsRefreshLive()">Muat Ulang Data</button>' +
        '</div>';
    }
  }

  function mountOdShippedShell() {
    var root = document.getElementById('pg-od-shipped');
    if (!root || ODS_STATE.uiMounted) return;

    root.innerHTML =
      /* 1. Control & Filter Toolbar */
      '<div class="ods-toolbar">' +
      '  <div class="ods-toolbar-top">' +
      '    <div class="ods-segmented" id="odsStreamToggle">' +
      '      <button type="button" class="ods-seg-btn active" data-stream="ALL" onclick="window.odsSetStream(\'ALL\')">Semua Pengiriman</button>' +
      '      <button type="button" class="ods-seg-btn" data-stream="REGULAR" onclick="window.odsSetStream(\'REGULAR\')">OD Regular (Data H6)</button>' +
      '      <button type="button" class="ods-seg-btn" data-stream="HUB_ALL" onclick="window.odsSetStream(\'HUB_ALL\')">Hub Transit Total</button>' +
      '      <button type="button" class="ods-seg-btn" data-stream="HUB_GRW" onclick="window.odsSetStream(\'HUB_GRW\')">Hub GRW (Data Hub)</button>' +
      '      <button type="button" class="ods-seg-btn" data-stream="HUB_CUST" onclick="window.odsSetStream(\'HUB_CUST\')">Hub Customer (Data Hub Cust)</button>' +
      '    </div>' +
      '    <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;">' +
      '      <div class="ods-segmented" id="odsMetricToggle">' +
      '        <button type="button" class="ods-seg-btn" data-metric="OD" onclick="window.odsSetMetric(\'OD\')">Satuan Grafik: Total OD</button>' +
      '        <button type="button" class="ods-seg-btn active" data-metric="CBM" onclick="window.odsSetMetric(\'CBM\')">Satuan Grafik: Kubikasi (CBM)</button>' +
      '      </div>' +
      '    </div>' +
      '  </div>' +
      '  <div class="ods-toolbar-filters">' +
      '    <div class="ods-field">' +
      '      <span class="ods-field-label">Periode</span>' +
      '      <input type="date" id="odsStartDate" class="ods-input ods-num" onchange="window.odsOnDateChange()">' +
      '      <span style="font-size:12px;color:#64748b;">s/d</span>' +
      '      <input type="date" id="odsEndDate" class="ods-input ods-num" onchange="window.odsOnDateChange()">' +
      '    </div>' +
      '    <div class="ods-segmented" id="odsPresetToggle">' +
      '      <button type="button" class="ods-seg-btn active" data-preset="ALL" onclick="window.odsSetPreset(\'ALL\')">YTD Semua</button>' +
      '      <button type="button" class="ods-seg-btn" data-preset="THIS_MONTH" onclick="window.odsSetPreset(\'THIS_MONTH\')">Bulan Terakhir</button>' +
      '      <button type="button" class="ods-seg-btn" data-preset="PREV_MONTH" onclick="window.odsSetPreset(\'PREV_MONTH\')">Bulan Lalu</button>' +
      '      <button type="button" class="ods-seg-btn" data-preset="30D" onclick="window.odsSetPreset(\'30D\')">30H</button>' +
      '      <button type="button" class="ods-seg-btn" data-preset="7D" onclick="window.odsSetPreset(\'7D\')">7H</button>' +
      '    </div>' +
      '    <div class="ods-field">' +
      '      <span class="ods-field-label">Bulan</span>' +
      '      <select id="odsMonthSelect" class="ods-select" onchange="window.odsOnMonthSelect(this.value)"></select>' +
      '    </div>' +
      '    <div class="ods-field">' +
      '      <span class="ods-field-label">Area</span>' +
      '      <div class="ods-segmented" id="odsAreaToggle">' +
      '        <button type="button" class="ods-seg-btn active" data-area="ALL" onclick="window.odsSetArea(\'ALL\')">ALL</button>' +
      '        <button type="button" class="ods-seg-btn" data-area="DK" onclick="window.odsSetArea(\'DK\')">DK</button>' +
      '        <button type="button" class="ods-seg-btn" data-area="LK" onclick="window.odsSetArea(\'LK\')">LK</button>' +
      '      </div>' +
      '    </div>' +
      '    <div class="ods-field">' +
      '      <span class="ods-field-label">Kategori</span>' +
      '      <select id="odsCategorySelect" class="ods-select" onchange="window.odsSetCategory(this.value)"></select>' +
      '    </div>' +
      '    <div class="ods-field">' +
      '      <span class="ods-field-label">Wilayah</span>' +
      '      <select id="odsWilayahSelect" class="ods-select" onchange="window.odsSetWilayah(this.value)"></select>' +
      '    </div>' +
      '    <div class="ods-actions">' +
      '      <button type="button" class="ods-btn" onclick="window.odsResetFilters()">Reset</button>' +
      '      <button type="button" class="ods-btn" onclick="window.odsExportActiveCsv()">Download CSV</button>' +
      '      <a href="' +
      SPREADSHEET_EDIT_URL +
      '" target="_blank" rel="noopener noreferrer" class="ods-btn">Buka Sheet</a>' +
      '      <button type="button" class="ods-btn ods-btn-primary" onclick="window.odsRefreshLive()">Refresh Live</button>' +
      '    </div>' +
      '  </div>' +
      '  <div class="ods-meta-line" id="odsMetaStatusLine"></div>' +
      '</div>' +
      /* 2. 6 Executive KPI Cards */
      '<div class="ods-kpi-grid">' +
      '  <div class="ods-kpi-box">' +
      '    <div class="ods-kpi-kicker">Grand Total OD Shipped</div>' +
      '    <div class="ods-kpi-main" id="odsKpiGrandTotal">0</div>' +
      '    <div class="ods-kpi-foot" id="odsKpiGrandFoot">—</div>' +
      '  </div>' +
      '  <div class="ods-kpi-box">' +
      '    <div class="ods-kpi-kicker">OD Regular (Data H6)</div>' +
      '    <div class="ods-kpi-main ods-text-blue" id="odsKpiRegular">0</div>' +
      '    <div class="ods-kpi-foot" id="odsKpiRegularFoot">—</div>' +
      '  </div>' +
      '  <div class="ods-kpi-box">' +
      '    <div class="ods-kpi-kicker">Hub Transit (Hub + Hub Cust)</div>' +
      '    <div class="ods-kpi-main ods-text-teal" id="odsKpiHubTotal">0</div>' +
      '    <div class="ods-kpi-foot" id="odsKpiHubFoot">—</div>' +
      '  </div>' +
      '  <div class="ods-kpi-box">' +
      '    <div class="ods-kpi-kicker">Rata-Rata Pengiriman Harian</div>' +
      '    <div class="ods-kpi-main ods-text-indigo" id="odsKpiAvgDaily">0</div>' +
      '    <div class="ods-kpi-foot" id="odsKpiAvgDailyFoot">—</div>' +
      '  </div>' +
      '  <div class="ods-kpi-box">' +
      '    <div class="ods-kpi-kicker">Rata-Rata Bulanan &amp; Densitas</div>' +
      '    <div class="ods-kpi-main" id="odsKpiAvgMonthly">0</div>' +
      '    <div class="ods-kpi-foot" id="odsKpiAvgMonthlyFoot">—</div>' +
      '  </div>' +
      '  <div class="ods-kpi-box">' +
      '    <div class="ods-kpi-kicker">Puncak Harian &amp; Surge Factor</div>' +
      '    <div class="ods-kpi-main ods-text-amber" id="odsKpiPeak">0</div>' +
      '    <div class="ods-kpi-foot" id="odsKpiPeakFoot">—</div>' +
      '  </div>' +
      '</div>' +
      /* 3. Executive Management Decision Intelligence */
      '<div class="ods-section">' +
      '  <div class="ods-section-head">' +
      '    <div>' +
      '      <div class="ods-section-title">Ringkasan Analisa &amp; Dukungan Keputusan Manajemen</div>' +
      '      <div class="ods-section-sub">Indikator kapasitas operasional, laju pertumbuhan bulanan, struktur beban distribusi, dan performa konsolidasi Hub Transit</div>' +
      '    </div>' +
      '  </div>' +
      '  <div class="ods-insights-grid" id="odsExecutiveInsights"></div>' +
      '</div>' +
      /* 4. Monthly Performance & Daily Average Chart */
      '<div class="ods-section">' +
      '  <div class="ods-section-head">' +
      '    <div>' +
      '      <div class="ods-section-title" id="odsMonthlyChartTitle">Tren Pengiriman Per Bulan: Regular vs Hub Transit</div>' +
      '      <div class="ods-section-sub">Komparasi kontribusi bulanan OD Regular (Data H6) dan Hub Transit (GRW &amp; Customer)</div>' +
      '    </div>' +
      '    <div class="ods-segmented" id="odsMonthlySeriesToggle">' +
      '      <button type="button" class="ods-seg-btn active" data-series="ALL" onclick="window.odsSetMonthlySeries(\'ALL\')">Semua</button>' +
      '      <button type="button" class="ods-seg-btn" data-series="REGULAR" onclick="window.odsSetMonthlySeries(\'REGULAR\')">Regular</button>' +
      '      <button type="button" class="ods-seg-btn" data-series="HUB" onclick="window.odsSetMonthlySeries(\'HUB\')">Hub (GRW+Cust)</button>' +
      '    </div>' +
      '  </div>' +
      '  <div class="ods-chart-box"><canvas id="odsMonthlyChart"></canvas></div>' +
      '</div>' +
      /* 5. Split Charts: Category Breakdown & Day-of-Week Load Profile */
      '<div class="ods-charts-split">' +
      '  <div class="ods-section" style="margin-bottom:0;">' +
      '    <div class="ods-section-head">' +
      '      <div>' +
      '        <div class="ods-section-title">Distribusi OD Shipped Per Kategori Order</div>' +
      '        <div class="ods-section-sub">Peringkat volume pengiriman berdasarkan Type Order (Regular &amp; Hub Transit)</div>' +
      '      </div>' +
      '    </div>' +
      '    <div class="ods-chart-box-sm"><canvas id="odsCategoryChart"></canvas></div>' +
      '  </div>' +
      '  <div class="ods-section" style="margin-bottom:0;">' +
      '    <div class="ods-section-head">' +
      '      <div>' +
      '        <div class="ods-section-title">Rata-Rata Beban Hari Kerja (Senin – Minggu)</div>' +
      '        <div class="ods-section-sub">Pola rata-rata pengiriman per hari untuk perencanaan shift manpower &amp; armada</div>' +
      '      </div>' +
      '    </div>' +
      '    <div class="ods-chart-box-sm"><canvas id="odsDowChart"></canvas></div>' +
      '  </div>' +
      '</div>' +
      /* 6. Daily Trend + 7-Day Moving Average Chart */
      '<div class="ods-section">' +
      '  <div class="ods-section-head">' +
      '    <div>' +
      '      <div class="ods-section-title">Tren Harian OD Shipped &amp; Rata-Rata Bergerak 7 Hari (MA-7)</div>' +
      '      <div class="ods-section-sub">Fluktuasi pengiriman harian OD Regular vs Hub Transit serta garis tren Moving Average 7-Hari</div>' +
      '    </div>' +
      '  </div>' +
      '  <div class="ods-chart-box"><canvas id="odsDailyChart"></canvas></div>' +
      '</div>' +
      /* 6.5 Executive Rankings: Top Wilayah, Top Per Hari, Hari & Bulan Tersibuk */
      '<div class="ods-section">' +
      '  <div class="ods-section-head">' +
      '    <div>' +
      '      <div class="ods-section-title">Analisis Peringkat Eksekutif (Top Wilayah, Top Harian, Hari &amp; Bulan Tersibuk)</div>' +
      '      <div class="ods-section-sub">Ringkasan analitis untuk evaluasi target operasional NDC Sidoarjo</div>' +
      '    </div>' +
      '  </div>' +
      '  <div id="odsRankingsContainer" style="display:grid; grid-template-columns:repeat(auto-fit, minmax(260px, 1fr)); gap:16px;"></div>' +
      '</div>' +
      /* 7. Detailed Multi-Tab Tables */
      '<div class="ods-section">' +
      '  <div class="ods-table-toolbar">' +
      '    <div class="ods-segmented" id="odsDetailTabs">' +
      '      <button type="button" class="ods-seg-btn active" data-tab="monthly" onclick="window.odsSwitchTab(\'monthly\')">1. Rekap Per Bulan</button>' +
      '      <button type="button" class="ods-seg-btn" data-tab="category" onclick="window.odsSwitchTab(\'category\')">2. Rekap Per Kategori</button>' +
      '      <button type="button" class="ods-seg-btn" data-tab="daily" onclick="window.odsSwitchTab(\'daily\')">3. Rekap Per Tanggal</button>' +
      '      <button type="button" class="ods-seg-btn" data-tab="regional" onclick="window.odsSwitchTab(\'regional\')">4. Analisa Wilayah &amp; Asal Hub</button>' +
      '    </div>' +
      '    <div id="odsTabExtraControls" style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;"></div>' +
      '  </div>' +
      '  <div id="odsTabContentArea"></div>' +
      '</div>';

    ODS_STATE.uiMounted = true;
  }

  function populateDynamicSelects() {
    var cube = ODS_STATE.cube;
    if (!cube) return;

    // Months
    var monthSet = {};
    cube.dicts.dates.forEach(function (d) {
      monthSet[d.slice(0, 7)] = true;
    });
    var months = Object.keys(monthSet).sort();
    var mSel = document.getElementById('odsMonthSelect');
    if (mSel) {
      mSel.innerHTML =
        '<option value="ALL">Semua Bulan (' +
        months.length +
        ')</option>' +
        months
          .map(function (ym) {
            return '<option value="' + ym + '">' + formatYmLabel(ym) + '</option>';
          })
          .join('');
    }

    // Categories
    var cats = cube.dicts.categories.slice().sort();
    var cSel = document.getElementById('odsCategorySelect');
    if (cSel) {
      cSel.innerHTML =
        '<option value="ALL">Semua Kategori (' +
        cats.length +
        ')</option>' +
        cats
          .map(function (c) {
            return '<option value="' + escHtml(c) + '">' + escHtml(c) + '</option>';
          })
          .join('');
    }

    // Wilayah
    var wils = cube.dicts.wilayahs.slice().sort();
    var wSel = document.getElementById('odsWilayahSelect');
    if (wSel) {
      wSel.innerHTML =
        '<option value="ALL">Semua Wilayah (' +
        wils.length +
        ')</option>' +
        wils
          .map(function (w) {
            return '<option value="' + escHtml(w) + '">' + escHtml(w) + '</option>';
          })
          .join('');
    }
  }

  function syncFilterControls() {
    var sIn = document.getElementById('odsStartDate');
    var eIn = document.getElementById('odsEndDate');
    if (sIn) sIn.value = ODS_STATE.startDate;
    if (eIn) eIn.value = ODS_STATE.endDate;

    var mSel = document.getElementById('odsMonthSelect');
    if (mSel) mSel.value = ODS_STATE.month;

    var cSel = document.getElementById('odsCategorySelect');
    if (cSel) cSel.value = ODS_STATE.category;

    var wSel = document.getElementById('odsWilayahSelect');
    if (wSel) wSel.value = ODS_STATE.wilayah;

    function toggleButtons(containerId, attr, activeVal) {
      var wrap = document.getElementById(containerId);
      if (!wrap) return;
      wrap.querySelectorAll('button').forEach(function (b) {
        if (b.getAttribute(attr) === activeVal) b.classList.add('active');
        else b.classList.remove('active');
      });
    }

    toggleButtons('odsStreamToggle', 'data-stream', ODS_STATE.stream);
    toggleButtons('odsMetricToggle', 'data-metric', ODS_STATE.metric);
    toggleButtons('odsPresetToggle', 'data-preset', ODS_STATE.preset);
    toggleButtons('odsAreaToggle', 'data-area', ODS_STATE.area);
    toggleButtons('odsDetailTabs', 'data-tab', ODS_STATE.activeTab);
    toggleButtons('odsMonthlySeriesToggle', 'data-series', ODS_STATE.monthlySeries);
  }

  function computeAnalytics() {
    var cube = ODS_STATE.cube;
    if (!cube) return null;

    var dates = cube.dicts.dates;
    var cats = cube.dicts.categories;
    var macros = cube.dicts.macroGroups;
    var areas = cube.dicts.areas;
    var wilayahs = cube.dicts.wilayahs;
    var origins = cube.dicts.origins;

    var sDate = ODS_STATE.startDate || '0000-00-00';
    var eDate = ODS_STATE.endDate || '9999-99-99';
    var monthF = ODS_STATE.month;
    var streamF = ODS_STATE.stream;
    var areaF = ODS_STATE.area;
    var catF = ODS_STATE.category;
    var wilF = ODS_STATE.wilayah;

    var totals = {
      orders: 0,
      cbm: 0,
      regOrders: 0,
      regCbm: 0,
      hubGrwOrders: 0,
      hubGrwCbm: 0,
      hubCustOrders: 0,
      hubCustCbm: 0,
      dkOrders: 0,
      dkCbm: 0,
      lkOrders: 0,
      lkCbm: 0,
      hubOnTime: 0,
      hubDelay: 0,
      hubLeadTimeSum: 0,
      hubLeadTimeCount: 0,
    };

    var byDate = {};
    var byMonth = {};
    var byCategory = {};
    var byMacro = {};
    var byWilayah = {};
    var byOriginHubCust = {};

    var tuples = cube.tuples;
    for (var i = 0; i < tuples.length; i++) {
      var t = tuples[i];
      var dateIso = dates[t[0]];
      if (dateIso < sDate || dateIso > eDate) continue;
      var ym = dateIso.slice(0, 7);
      if (monthF !== 'ALL' && ym !== monthF) continue;

      var sheetIdx = t[1]; // 0=Data H6, 1=Data Hub, 2=Data Hub Cust
      if (streamF === 'REGULAR' && sheetIdx !== 0) continue;
      if (streamF === 'HUB_ALL' && sheetIdx === 0) continue;
      if (streamF === 'HUB_GRW' && sheetIdx !== 1) continue;
      if (streamF === 'HUB_CUST' && sheetIdx !== 2) continue;

      var areaName = areas[t[4]];
      if (areaF !== 'ALL' && areaName !== areaF) continue;

      var catName = cats[t[2]];
      if (catF !== 'ALL' && catName !== catF) continue;

      var wilName = wilayahs[t[5]];
      if (wilF !== 'ALL' && wilName !== wilF) continue;

      var macroName = macros[t[3]];
      var origName = origins[t[6]];
      var ord = t[7];
      var cbm = t[8];
      var onT = t[9];
      var del = t[10];
      var ltSum = t[11];
      var ltCnt = t[12];

      totals.orders += ord;
      totals.cbm += cbm;

      if (sheetIdx === 0) {
        totals.regOrders += ord;
        totals.regCbm += cbm;
      } else if (sheetIdx === 1) {
        totals.hubGrwOrders += ord;
        totals.hubGrwCbm += cbm;
        totals.hubOnTime += onT;
        totals.hubDelay += del;
        totals.hubLeadTimeSum += ltSum;
        totals.hubLeadTimeCount += ltCnt;
      } else {
        totals.hubCustOrders += ord;
        totals.hubCustCbm += cbm;
        totals.hubOnTime += onT;
        totals.hubDelay += del;

        if (!byOriginHubCust[origName]) {
          byOriginHubCust[origName] = { origin: origName, orders: 0, cbm: 0, onTime: 0, delay: 0 };
        }
        byOriginHubCust[origName].orders += ord;
        byOriginHubCust[origName].cbm += cbm;
        byOriginHubCust[origName].onTime += onT;
        byOriginHubCust[origName].delay += del;
      }

      if (areaName === 'DK') {
        totals.dkOrders += ord;
        totals.dkCbm += cbm;
      } else {
        totals.lkOrders += ord;
        totals.lkCbm += cbm;
      }

      // Daily bucket
      var dRec = byDate[dateIso];
      if (!dRec) {
        dRec = {
          date: dateIso,
          dow: getDowIndexFromIso(dateIso),
          orders: 0,
          cbm: 0,
          regOrders: 0,
          regCbm: 0,
          regDk: 0,
          regLk: 0,
          hubGrwOrders: 0,
          hubGrwCbm: 0,
          hubCustOrders: 0,
          hubCustCbm: 0,
          hubDk: 0,
          hubLk: 0,
        };
        byDate[dateIso] = dRec;
      }
      dRec.orders += ord;
      dRec.cbm += cbm;
      if (sheetIdx === 0) {
        dRec.regOrders += ord;
        dRec.regCbm += cbm;
        if (areaName === 'DK') dRec.regDk += ord;
        else dRec.regLk += ord;
      } else {
        if (sheetIdx === 1) {
          dRec.hubGrwOrders += ord;
          dRec.hubGrwCbm += cbm;
        } else {
          dRec.hubCustOrders += ord;
          dRec.hubCustCbm += cbm;
        }
        if (areaName === 'DK') dRec.hubDk += ord;
        else dRec.hubLk += ord;
      }

      // Monthly bucket
      var mRec = byMonth[ym];
      if (!mRec) {
        mRec = {
          ym: ym,
          orders: 0,
          cbm: 0,
          regOrders: 0,
          regCbm: 0,
          hubGrwOrders: 0,
          hubGrwCbm: 0,
          hubCustOrders: 0,
          hubCustCbm: 0,
          dkOrders: 0,
          lkOrders: 0,
          daysMap: {},
        };
        byMonth[ym] = mRec;
      }
      mRec.orders += ord;
      mRec.cbm += cbm;
      if (sheetIdx === 0) {
        mRec.regOrders += ord;
        mRec.regCbm += cbm;
      } else if (sheetIdx === 1) {
        mRec.hubGrwOrders += ord;
        mRec.hubGrwCbm += cbm;
      } else {
        mRec.hubCustOrders += ord;
        mRec.hubCustCbm += cbm;
      }
      if (areaName === 'DK') mRec.dkOrders += ord;
      else mRec.lkOrders += ord;
      mRec.daysMap[dateIso] = (mRec.daysMap[dateIso] || 0) + ord;

      // Category bucket
      var catKey = sheetIdx + '|' + catName;
      var cRec = byCategory[catKey];
      if (!cRec) {
        cRec = {
          category: catName,
          sourceSheet: cube.dicts.sheets[sheetIdx],
          sheetIdx: sheetIdx,
          macro: macroName,
          orders: 0,
          cbm: 0,
          dkOrders: 0,
          lkOrders: 0,
        };
        byCategory[catKey] = cRec;
      }
      cRec.orders += ord;
      cRec.cbm += cbm;
      if (areaName === 'DK') cRec.dkOrders += ord;
      else cRec.lkOrders += ord;

      // Macro group
      if (!byMacro[macroName]) {
        byMacro[macroName] = { macro: macroName, orders: 0, cbm: 0 };
      }
      byMacro[macroName].orders += ord;
      byMacro[macroName].cbm += cbm;

      // Wilayah bucket
      var wRec = byWilayah[wilName];
      if (!wRec) {
        wRec = {
          wilayah: wilName,
          orders: 0,
          cbm: 0,
          regOrders: 0,
          hubGrwOrders: 0,
          hubCustOrders: 0,
          dkOrders: 0,
          lkOrders: 0,
        };
        byWilayah[wilName] = wRec;
      }
      wRec.orders += ord;
      wRec.cbm += cbm;
      if (sheetIdx === 0) wRec.regOrders += ord;
      else if (sheetIdx === 1) wRec.hubGrwOrders += ord;
      else wRec.hubCustOrders += ord;
      if (areaName === 'DK') wRec.dkOrders += ord;
      else wRec.lkOrders += ord;
    }

    var dailyAsc = Object.keys(byDate)
      .sort()
      .map(function (k) {
        return byDate[k];
      });

    // Moving average 7 days & Peak / P90 stats
    var activeDays = dailyAsc.length;
    var avgDailyOrders = activeDays > 0 ? totals.orders / activeDays : 0;
    var avgDailyCbm = activeDays > 0 ? totals.cbm / activeDays : 0;

    var peakDay = null;
    var sortedDailyOrders = [];
    for (var dIdx = 0; dIdx < dailyAsc.length; dIdx++) {
      var curD = dailyAsc[dIdx];
      sortedDailyOrders.push(curD.orders);
      if (!peakDay || curD.orders > peakDay.orders) {
        peakDay = curD;
      }
      var winStart = Math.max(0, dIdx - 6);
      var sumOd = 0,
        sumCb = 0,
        cnt = 0;
      for (var w = winStart; w <= dIdx; w++) {
        sumOd += dailyAsc[w].orders;
        sumCb += dailyAsc[w].cbm;
        cnt++;
      }
      curD.ma7Orders = cnt > 0 ? sumOd / cnt : 0;
      curD.ma7Cbm = cnt > 0 ? sumCb / cnt : 0;
    }

    sortedDailyOrders.sort(function (a, b) {
      return a - b;
    });
    var p90Orders =
      sortedDailyOrders.length > 0
        ? sortedDailyOrders[Math.min(sortedDailyOrders.length - 1, Math.floor(sortedDailyOrders.length * 0.9))]
        : 0;
    var medianOrders =
      sortedDailyOrders.length > 0
        ? sortedDailyOrders[Math.floor(sortedDailyOrders.length * 0.5)]
        : 0;

    // Day-of-week profile
    var dowAcc = [0, 1, 2, 3, 4, 5, 6].map(function (dow) {
      return { dow: dow, name: DOW_NAMES_ID[dow], days: 0, orders: 0, cbm: 0, regOrders: 0, hubOrders: 0 };
    });
    dailyAsc.forEach(function (d) {
      var bucket = dowAcc[d.dow];
      bucket.days += 1;
      bucket.orders += d.orders;
      bucket.cbm += d.cbm;
      bucket.regOrders += d.regOrders;
      bucket.hubOrders += d.hubGrwOrders + d.hubCustOrders;
    });
    dowAcc.forEach(function (b) {
      b.avgOrders = b.days > 0 ? b.orders / b.days : 0;
      b.avgCbm = b.days > 0 ? b.cbm / b.days : 0;
      b.avgRegOrders = b.days > 0 ? b.regOrders / b.days : 0;
      b.avgHubOrders = b.days > 0 ? b.hubOrders / b.days : 0;
    });

    // Monthly array with MoM growth & peak day per month
    var monthlyAsc = Object.keys(byMonth)
      .sort()
      .map(function (ym, idx, arr) {
        var m = byMonth[ym];
        var dayKeys = Object.keys(m.daysMap);
        m.activeDays = dayKeys.length;
        m.avgDailyOrders = m.activeDays > 0 ? m.orders / m.activeDays : 0;
        m.avgDailyCbm = m.activeDays > 0 ? m.cbm / m.activeDays : 0;
        m.hubTotalOrders = m.hubGrwOrders + m.hubCustOrders;
        m.hubSharePct = m.orders > 0 ? (m.hubTotalOrders / m.orders) * 100 : 0;

        var bestDate = '';
        var bestVal = -1;
        dayKeys.forEach(function (dk) {
          if (m.daysMap[dk] > bestVal) {
            bestVal = m.daysMap[dk];
            bestDate = dk;
          }
        });
        m.peakDate = bestDate;
        m.peakOrders = bestVal > 0 ? bestVal : 0;

        if (idx > 0) {
          var prev = byMonth[arr[idx - 1]];
          // Compare daily average MoM as well as total MoM (handles partial current month fairly)
          m.momTotalPct = prev.orders > 0 ? ((m.orders - prev.orders) / prev.orders) * 100 : null;
          var prevAvg = prev.activeDays > 0 ? prev.orders / prev.activeDays : 0;
          m.momDailyAvgPct = prevAvg > 0 ? ((m.avgDailyOrders - prevAvg) / prevAvg) * 100 : null;
        } else {
          m.momTotalPct = null;
          m.momDailyAvgPct = null;
        }
        return m;
      });

    var categoryList = Object.keys(byCategory).map(function (k) {
      var c = byCategory[k];
      c.shareOrdersPct = totals.orders > 0 ? (c.orders / totals.orders) * 100 : 0;
      c.shareCbmPct = totals.cbm > 0 ? (c.cbm / totals.cbm) * 100 : 0;
      c.avgDailyOrders = activeDays > 0 ? c.orders / activeDays : 0;
      c.avgCbmPerOrder = c.orders > 0 ? c.cbm / c.orders : 0;
      return c;
    });

    var wilayahList = Object.keys(byWilayah)
      .map(function (k) {
        var w = byWilayah[k];
        w.hubOrders = w.hubGrwOrders + w.hubCustOrders;
        w.shareOrdersPct = totals.orders > 0 ? (w.orders / totals.orders) * 100 : 0;
        w.shareCbmPct = totals.cbm > 0 ? (w.cbm / totals.cbm) * 100 : 0;
        w.avgCbmPerOrder = w.orders > 0 ? w.cbm / w.orders : 0;
        return w;
      })
      .sort(function (a, b) {
        return b.orders - a.orders;
      });

    var originList = Object.keys(byOriginHubCust)
      .map(function (k) {
        var o = byOriginHubCust[k];
        var totSla = o.onTime + o.delay;
        o.slaPct = totSla > 0 ? (o.onTime / totSla) * 100 : 100;
        o.sharePct = totals.hubCustOrders > 0 ? (o.orders / totals.hubCustOrders) * 100 : 0;
        return o;
      })
      .sort(function (a, b) {
        return b.orders - a.orders;
      });

    var macroListOut = Object.keys(byMacro)
      .map(function (k) {
        return byMacro[k];
      })
      .sort(function (a, b) {
        return b.orders - a.orders;
      });

    return {
      totals: totals,
      activeDays: activeDays,
      activeMonths: monthlyAsc.length,
      avgDailyOrders: avgDailyOrders,
      avgDailyCbm: avgDailyCbm,
      avgMonthlyOrders: monthlyAsc.length > 0 ? totals.orders / monthlyAsc.length : 0,
      avgMonthlyCbm: monthlyAsc.length > 0 ? totals.cbm / monthlyAsc.length : 0,
      avgCbmPerOrder: totals.orders > 0 ? totals.cbm / totals.orders : 0,
      peakDay: peakDay,
      p90Orders: p90Orders,
      medianOrders: medianOrders,
      surgeRatio: avgDailyOrders > 0 && peakDay ? peakDay.orders / avgDailyOrders : 0,
      dailyAsc: dailyAsc,
      monthlyAsc: monthlyAsc,
      categoryList: categoryList,
      macroList: macroListOut,
      wilayahList: wilayahList,
      originList: originList,
      dowAcc: dowAcc,
    };
  }

  function recomputeAndRender() {
    var comp = computeAnalytics();
    if (!comp) return;
    ODS_STATE.lastComputed = comp;

    renderMetaStatusLine(comp);
    renderKpiCards(comp);
    renderExecutiveInsights(comp);
    renderExecutiveRankings(comp);
    renderAllCharts(comp);
    renderActiveDetailTab(comp);
  }

  function renderMetaStatusLine(comp) {
    var el = document.getElementById('odsMetaStatusLine');
    if (!el || !ODS_STATE.cube) return;

    var rc = ODS_STATE.cube.rowCounts;
    var updatedStr = new Date(ODS_STATE.cube.updatedAt).toLocaleTimeString('id-ID');
    el.innerHTML =
      '<span>Sumber: <strong>Data H6</strong> (' +
      fmtInt(rc.h6Rows) +
      ' baris rekap) · <strong>Data Hub</strong> (' +
      fmtInt(rc.hubRows) +
      ' order) · <strong>Data Hub Cust</strong> (' +
      fmtInt(rc.hubCustRows) +
      ' order)</span>' +
      '<span class="ods-meta-sep">·</span>' +
      '<span>Hari Aktif Terfilter: <strong class="ods-num">' +
      fmtInt(comp.activeDays) +
      ' hari</strong> (' +
      fmtInt(comp.activeMonths) +
      ' bulan)</span>' +
      '<span class="ods-meta-sep">·</span>' +
      '<span>Sinkronisasi: <span class="ods-num">' +
      escHtml(updatedStr) +
      '</span></span>';
  }

  function renderKpiCards(comp) {
    var t = comp.totals;
    var hubTotal = t.hubGrwOrders + t.hubCustOrders;
    var hubCbm = t.hubGrwCbm + t.hubCustCbm;
    var regShare = t.orders > 0 ? (t.regOrders / t.orders) * 100 : 0;
    var hubShare = t.orders > 0 ? (hubTotal / t.orders) * 100 : 0;

    var setEl = function (id, html) {
      var node = document.getElementById(id);
      if (node) node.innerHTML = html;
    };

    setEl('odsKpiGrandTotal', fmtDec(t.cbm, 1) + ' <span style="font-size:13px;font-weight:600;color:#64748b;">m³</span>');
    setEl(
      'odsKpiGrandFoot',
      'Total OD: <strong>' +
        fmtInt(t.orders) +
        ' OD</strong> (~' +
        fmtInt(t.cbm / 60) +
        ' Cont-40) · DK ' +
        fmtPct(t.orders > 0 ? (t.dkOrders / t.orders) * 100 : 0, 1) +
        ' / LK ' +
        fmtPct(t.orders > 0 ? (t.lkOrders / t.orders) * 100 : 0, 1)
    );

    setEl('odsKpiRegular', fmtDec(t.regCbm, 1) + ' <span style="font-size:13px;font-weight:600;color:#64748b;">m³</span>');
    setEl(
      'odsKpiRegularFoot',
      'Total OD: <strong>' +
        fmtInt(t.regOrders) +
        ' OD</strong> · Porsi <strong>' +
        fmtPct(regShare, 1) +
        '</strong> · Avg ' +
        fmtDec(t.regCbm / Math.max(1, comp.activeDays), 1) +
        ' m³/hari'
    );

    setEl('odsKpiHubTotal', fmtDec(hubCbm, 1) + ' <span style="font-size:13px;font-weight:600;color:#64748b;">m³</span>');
    setEl(
      'odsKpiHubFoot',
      'Total OD: <strong>' +
        fmtInt(hubTotal) +
        ' OD</strong> · Hub GRW <strong>' +
        fmtDec(t.hubGrwCbm, 1) +
        ' m³</strong> · Hub Cust <strong>' +
        fmtDec(t.hubCustCbm, 1) +
        ' m³</strong>'
    );

    setEl(
      'odsKpiAvgDaily',
      fmtDec(comp.avgDailyCbm, 1) + ' <span style="font-size:13px;font-weight:600;color:#64748b;">m³/hari</span>'
    );
    setEl(
      'odsKpiAvgDailyFoot',
      'Avg OD: <strong>' +
        fmtDec(comp.avgDailyOrders, 0) +
        ' OD/hari</strong> (~' +
        fmtDec(comp.avgDailyCbm / 40, 1) +
        ' Wingbox/hari) · Median ' +
        fmtDec(comp.medianCbm || 0, 1) +
        ' m³'
    );

    setEl(
      'odsKpiAvgMonthly',
      fmtDec(comp.avgMonthlyCbm, 0) + ' <span style="font-size:13px;font-weight:600;color:#64748b;">m³/bln</span>'
    );
    setEl(
      'odsKpiAvgMonthlyFoot',
      'Avg OD: <strong>' +
        fmtInt(comp.avgMonthlyOrders) +
        ' OD/bln</strong> · Densitas <strong>' +
        fmtDec(comp.avgCbmPerOrder, 2) +
        ' m³</strong> per OD'
    );

    if (comp.peakDay) {
      setEl(
        'odsKpiPeak',
        fmtDec(comp.peakDay.cbm, 1) +
          ' <span style="font-size:13px;font-weight:600;color:#64748b;">m³ (' +
          fmtDec(comp.surgeRatio, 2) +
          'x)</span>'
      );
      setEl(
        'odsKpiPeakFoot',
        'Tanggal: <strong>' +
          formatIsoToIdShort(comp.peakDay.date) +
          '</strong> (' +
          fmtInt(comp.peakDay.orders) +
          ' OD)'
      );
    } else {
      setEl('odsKpiPeak', '0');
      setEl('odsKpiPeakFoot', 'Tidak ada data pada filter ini');
    }
  }

  function renderExecutiveInsights(comp) {
    var box = document.getElementById('odsExecutiveInsights');
    if (!box) return;

    var t = comp.totals;
    if (t.orders === 0) {
      box.innerHTML =
        '<div style="grid-column:1/-1;font-size:13px;color:#64748b;">Tidak ada transaksi OD Shipped yang cocok dengan kombinasi filter saat ini.</div>';
      return;
    }

    // 1. Capacity & Fleet Planning Insight
    var wingboxAvg = comp.avgDailyCbm / 40;
    var p90CbmEst = comp.p90Orders * comp.avgCbmPerOrder;
    var wingboxP90 = p90CbmEst / 40;

    var busiestDow = comp.dowAcc.slice().sort(function (a, b) {
      return b.avgOrders - a.avgOrders;
    })[0];
    var quietestDow = comp.dowAcc
      .filter(function (d) {
        return d.days > 0;
      })
      .sort(function (a, b) {
        return a.avgOrders - b.avgOrders;
      })[0];

    // 2. MoM Trend Insight (compare latest 2 months with >=15 days if available, else latest 2)
    var fullMonths = comp.monthlyAsc.filter(function (m) {
      return m.activeDays >= 15;
    });
    var mPair = fullMonths.length >= 2 ? fullMonths.slice(-2) : comp.monthlyAsc.slice(-2);
    var momHeadline = 'Stabil';
    var momDesc = 'Pilih rentang minimal 2 bulan untuk melihat dinamika laju pertumbuhan bulanan (MoM).';
    if (mPair.length === 2) {
      var prevM = mPair[0];
      var currM = mPair[1];
      var diffAvgPct =
        prevM.avgDailyOrders > 0
          ? ((currM.avgDailyOrders - prevM.avgDailyOrders) / prevM.avgDailyOrders) * 100
          : 0;
      var sign = diffAvgPct >= 0 ? '+' : '';
      momHeadline = sign + fmtPct(diffAvgPct, 1) + ' Avg/Hari';
      momDesc =
        'Rata-rata harian <strong>' +
        formatYmShort(currM.ym) +
        '</strong> (' +
        fmtInt(currM.avgDailyOrders) +
        ' OD/hr) dibanding <strong>' +
        formatYmShort(prevM.ym) +
        '</strong> (' +
        fmtInt(prevM.avgDailyOrders) +
        ' OD/hr). Porsi Hub Transit di ' +
        formatYmShort(currM.ym) +
        ' mencapai <strong>' +
        fmtPct(currM.hubSharePct, 1) +
        '</strong>.';
    }

    // 3. Category & Regional Concentration
    var topCat = comp.categoryList.slice().sort(function (a, b) {
      return b.orders - a.orders;
    })[0];
    var topWil = comp.wilayahList[0];
    var lkCbmShare = t.cbm > 0 ? (t.lkCbm / t.cbm) * 100 : 0;

    // 4. Hub Transit SLA & Origin Supply
    var hubSlaDenom = t.hubOnTime + t.hubDelay;
    var hubSlaPct = hubSlaDenom > 0 ? (t.hubOnTime / hubSlaDenom) * 100 : 100;
    var avgHubLt = t.hubLeadTimeCount > 0 ? t.hubLeadTimeSum / t.hubLeadTimeCount : 0;
    var topOrigin = comp.originList[0];

    box.innerHTML =
      '<div class="ods-insight-item">' +
      '  <div class="ods-insight-title">1. Standar Kapasitas &amp; Buffer Harian</div>' +
      '  <div class="ods-insight-metric">' +
      fmtInt(comp.avgDailyOrders) +
      ' → ' +
      fmtInt(comp.p90Orders) +
      ' OD/hr</div>' +
      '  <div class="ods-insight-desc">Baseline harian setara <strong>~' +
      fmtDec(wingboxAvg, 1) +
      ' Wingbox</strong> (' +
      fmtDec(comp.avgDailyCbm, 0) +
      ' m³), namun manajemen disarankan menyiapkan buffer kapasitas P90 sebesar <strong>~' +
      fmtDec(wingboxP90, 1) +
      ' Wingbox/hari</strong> terutama setiap hari <strong>' +
      escHtml(busiestDow ? busiestDow.name : '—') +
      '</strong> (rata-rata tertinggi ' +
      fmtInt(busiestDow ? busiestDow.avgOrders : 0) +
      ' OD, vs terendah ' +
      escHtml(quietestDow ? quietestDow.name : '—') +
      ' ' +
      fmtInt(quietestDow ? quietestDow.avgOrders : 0) +
      ' OD).</div>' +
      '</div>' +
      '<div class="ods-insight-item">' +
      '  <div class="ods-insight-title">2. Laju Pertumbuhan Bulanan (MoM)</div>' +
      '  <div class="ods-insight-metric">' +
      momHeadline +
      '</div>' +
      '  <div class="ods-insight-desc">' +
      momDesc +
      '</div>' +
      '</div>' +
      '<div class="ods-insight-item">' +
      '  <div class="ods-insight-title">3. Konsentrasi Kategori &amp; Koridor Wilayah</div>' +
      '  <div class="ods-insight-metric">' +
      fmtPct(lkCbmShare, 1) +
      ' CBM Luar Kota</div>' +
      '  <div class="ods-insight-desc">Kategori terbesar adalah <strong>' +
      escHtml(topCat ? topCat.category : '—') +
      '</strong> (' +
      fmtPct(topCat ? topCat.shareOrdersPct : 0, 1) +
      ' total OD). Wilayah tujuan utama dipimpin oleh <strong>' +
      escHtml(topWil ? topWil.wilayah : '—') +
      '</strong> (' +
      fmtInt(topWil ? topWil.orders : 0) +
      ' OD · ' +
      fmtDec(topWil ? topWil.cbm : 0, 0) +
      ' m³).</div>' +
      '</div>' +
      '<div class="ods-insight-item">' +
      '  <div class="ods-insight-title">4. Performa &amp; Suplai Hub Transit</div>' +
      '  <div class="ods-insight-metric">' +
      fmtPct(hubSlaPct, 2) +
      ' On-Time SLA</div>' +
      '  <div class="ods-insight-desc">Rata-rata lead time Hub Store <strong>' +
      fmtDec(avgHubLt, 1) +
      ' hari</strong> (' +
      fmtInt(t.hubDelay) +
      ' order delay dari ' +
      fmtInt(hubSlaDenom) +
      ' order transit). Suplai Hub Customer terbesar berasal dari <strong>' +
      escHtml(topOrigin ? topOrigin.origin : 'WH Utama') +
      '</strong> (' +
      fmtPct(topOrigin ? topOrigin.sharePct : 0, 1) +
      ').</div>' +
      '</div>';
  }

  function renderExecutiveRankings(comp) {
    var container = document.getElementById('odsRankingsContainer');
    if (!container) return;

    var isCbm = ODS_STATE.metric === 'CBM';

    // 1. Top 5 Wilayah Tujuan
    var topWil = comp.wilayahList.slice().sort(function (a, b) {
      return isCbm ? b.cbm - a.cbm : b.orders - a.orders;
    }).slice(0, 5);

    var totalMetricWil = comp.wilayahList.reduce(function (sum, w) {
      return sum + (isCbm ? w.cbm : w.orders);
    }, 0) || 1;

    var wilHtml = topWil.map(function (w, i) {
      var val = isCbm ? w.cbm : w.orders;
      var valStr = isCbm ? fmtDec(val, 1) + ' m³' : fmtInt(val) + ' OD';
      var pct = (val / totalMetricWil) * 100;
      return (
        '<div style="display:flex;align-items:center;justify-content:space-between;padding:6px 0;border-bottom:1px solid rgba(226,232,240,0.6);font-size:12.5px;">' +
        '  <div style="display:flex;align-items:center;gap:8px;min-width:0;">' +
        '    <span style="display:inline-flex;align-items:center;justify-content:center;width:20px;height:20px;border-radius:50%;background:#eff6ff;color:#2563eb;font-weight:700;font-size:11px;flex-shrink:0;">' + (i + 1) + '</span>' +
        '    <span style="font-weight:600;color:#1e293b;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + escHtml(w.wilayah) + '</span>' +
        '  </div>' +
        '  <div style="text-align:right;flex-shrink:0;margin-left:8px;">' +
        '    <strong style="color:#0f172a;">' + valStr + '</strong>' +
        '    <span style="font-size:11px;color:#64748b;margin-left:4px;">(' + fmtPct(pct, 1) + ')</span>' +
        '  </div>' +
        '</div>'
      );
    }).join('');

    // 2. Top 5 Hari / Tanggal Pengiriman
    var topDays = comp.dailyAsc.slice().sort(function (a, b) {
      return isCbm ? b.cbm - a.cbm : b.orders - a.orders;
    }).slice(0, 5);

    var avgDailyVal = isCbm ? comp.avgDailyCbm : comp.avgDailyOrders;

    var daysHtml = topDays.map(function (d, i) {
      var val = isCbm ? d.cbm : d.orders;
      var valStr = isCbm ? fmtDec(val, 1) + ' m³' : fmtInt(val) + ' OD';
      var surge = avgDailyVal > 0 ? val / avgDailyVal : 1;
      var dayName = DOW_NAMES_ID[d.dow] || '';
      var dtFormatted = formatIsoToIdShort(d.date);
      return (
        '<div style="display:flex;align-items:center;justify-content:space-between;padding:6px 0;border-bottom:1px solid rgba(226,232,240,0.6);font-size:12.5px;">' +
        '  <div style="display:flex;align-items:center;gap:8px;min-width:0;">' +
        '    <span style="display:inline-flex;align-items:center;justify-content:center;width:20px;height:20px;border-radius:50%;background:#fef3c7;color:#b45309;font-weight:700;font-size:11px;flex-shrink:0;">' + (i + 1) + '</span>' +
        '    <span style="font-weight:600;color:#1e293b;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + dtFormatted + ' <span style="font-size:11px;color:#64748b;">(' + dayName + ')</span></span>' +
        '  </div>' +
        '  <div style="text-align:right;flex-shrink:0;margin-left:8px;">' +
        '    <strong style="color:#d97706;">' + valStr + '</strong>' +
        '    <span style="font-size:11px;color:#dc2626;font-weight:600;margin-left:4px;">' + fmtDec(surge, 2) + 'x</span>' +
        '  </div>' +
        '</div>'
      );
    }).join('');

    // 3. Hari Tersibuk (Day of Week Analysis)
    var sortedDow = comp.dowAcc.slice().sort(function (a, b) {
      var va = isCbm ? a.avgCbm : a.avgOrders;
      var vb = isCbm ? b.avgCbm : b.avgOrders;
      return vb - va;
    });

    var dowHtml = sortedDow.map(function (d, i) {
      var val = isCbm ? d.avgCbm : d.avgOrders;
      var valStr = isCbm ? fmtDec(val, 1) + ' m³/hr' : fmtInt(val) + ' OD/hr';
      var isPeak = i === 0;
      var badgeBg = isPeak ? '#dcfce7' : '#f1f5f9';
      var badgeColor = isPeak ? '#15803d' : '#475569';
      return (
        '<div style="display:flex;align-items:center;justify-content:space-between;padding:6px 0;border-bottom:1px solid rgba(226,232,240,0.6);font-size:12.5px;">' +
        '  <div style="display:flex;align-items:center;gap:8px;">' +
        '    <span style="display:inline-flex;align-items:center;justify-content:center;padding:2px 6px;border-radius:4px;background:' + badgeBg + ';color:' + badgeColor + ';font-weight:700;font-size:11px;">' + d.name + '</span>' +
        '    <span style="font-size:11px;color:#64748b;">' + d.days + ' hari</span>' +
        '  </div>' +
        '  <div style="text-align:right;">' +
        '    <strong style="color:#0f172a;">' + valStr + '</strong>' +
        '  </div>' +
        '</div>'
      );
    }).join('');

    // 4. Bulan Tersibuk
    var sortedMonths = comp.monthlyAsc.slice().sort(function (a, b) {
      return isCbm ? b.cbm - a.cbm : b.orders - a.orders;
    }).slice(0, 5);

    var monthHtml = sortedMonths.map(function (m, i) {
      var val = isCbm ? m.cbm : m.orders;
      var valStr = isCbm ? fmtDec(val, 0) + ' m³' : fmtInt(val) + ' OD';
      var avgStr = isCbm ? fmtDec(m.avgDailyCbm, 1) + ' m³/hr' : fmtInt(m.avgDailyOrders) + ' OD/hr';
      return (
        '<div style="display:flex;align-items:center;justify-content:space-between;padding:6px 0;border-bottom:1px solid rgba(226,232,240,0.6);font-size:12.5px;">' +
        '  <div style="display:flex;align-items:center;gap:8px;min-width:0;">' +
        '    <span style="display:inline-flex;align-items:center;justify-content:center;width:20px;height:20px;border-radius:50%;background:#f3e8ff;color:#7e22ce;font-weight:700;font-size:11px;flex-shrink:0;">' + (i + 1) + '</span>' +
        '    <span style="font-weight:600;color:#1e293b;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + formatYmLabel(m.ym) + '</span>' +
        '  </div>' +
        '  <div style="text-align:right;flex-shrink:0;margin-left:8px;">' +
        '    <strong style="color:#7c3aed;">' + valStr + '</strong>' +
        '    <span style="font-size:11px;color:#64748b;margin-left:4px;">(' + avgStr + ')</span>' +
        '  </div>' +
        '</div>'
      );
    }).join('');

    container.innerHTML =
      '<div class="ods-kpi-box" style="padding:14px;background:#ffffff;border:1px solid #e2e8f0;border-radius:8px;">' +
      '  <div style="font-size:11px;font-weight:700;letter-spacing:0.5px;color:#2563eb;margin-bottom:8px;text-transform:uppercase;">1. Top Wilayah Tujuan (' + (isCbm ? 'CBM' : 'OD') + ')</div>' +
      (wilHtml || '<div style="font-size:12px;color:#64748b;">Tidak ada data</div>') +
      '</div>' +
      '<div class="ods-kpi-box" style="padding:14px;background:#ffffff;border:1px solid #e2e8f0;border-radius:8px;">' +
      '  <div style="font-size:11px;font-weight:700;letter-spacing:0.5px;color:#d97706;margin-bottom:8px;text-transform:uppercase;">2. Top Tanggal Pengiriman (' + (isCbm ? 'CBM' : 'OD') + ')</div>' +
      (daysHtml || '<div style="font-size:12px;color:#64748b;">Tidak ada data</div>') +
      '</div>' +
      '<div class="ods-kpi-box" style="padding:14px;background:#ffffff;border:1px solid #e2e8f0;border-radius:8px;">' +
      '  <div style="font-size:11px;font-weight:700;letter-spacing:0.5px;color:#15803d;margin-bottom:8px;text-transform:uppercase;">3. Analisis Hari Tersibuk (DOW)</div>' +
      (dowHtml || '<div style="font-size:12px;color:#64748b;">Tidak ada data</div>') +
      '</div>' +
      '<div class="ods-kpi-box" style="padding:14px;background:#ffffff;border:1px solid #e2e8f0;border-radius:8px;">' +
      '  <div style="font-size:11px;font-weight:700;letter-spacing:0.5px;color:#7c3aed;margin-bottom:8px;text-transform:uppercase;">4. Bulan Tersibuk &amp; Volume</div>' +
      (monthHtml || '<div style="font-size:12px;color:#64748b;">Tidak ada data</div>') +
      '</div>';
  }

  function renderAllCharts(comp) {
    if (typeof window.Chart === 'undefined') return;
    var isCbm = ODS_STATE.metric === 'CBM';
    var unitLabel = isCbm ? 'CBM (m³)' : 'Total OD';
    var seriesChoice = ODS_STATE.monthlySeries || 'ALL';

    // 1. Monthly Chart
    var mCanvas = document.getElementById('odsMonthlyChart');
    if (mCanvas) {
      if (charts.monthly) charts.monthly.destroy();
      var mLabels = comp.monthlyAsc.map(function (m) {
        return formatYmShort(m.ym);
      });
      var mReg = comp.monthlyAsc.map(function (m) {
        return isCbm ? Math.round(m.regCbm * 10) / 10 : m.regOrders;
      });
      var mHubGrw = comp.monthlyAsc.map(function (m) {
        return isCbm ? Math.round(m.hubGrwCbm * 10) / 10 : m.hubGrwOrders;
      });
      var mHubCust = comp.monthlyAsc.map(function (m) {
        return isCbm ? Math.round(m.hubCustCbm * 10) / 10 : m.hubCustOrders;
      });
      var mAvgDaily = comp.monthlyAsc.map(function (m) {
        return isCbm ? Math.round(m.avgDailyCbm * 10) / 10 : Math.round(m.avgDailyOrders);
      });

      var mDatasets = [];

      if (seriesChoice === 'ALL' || seriesChoice === 'REGULAR') {
        mDatasets.push({
          type: 'bar',
          label: 'OD Regular (Data H6)',
          data: mReg,
          backgroundColor: '#2563eb',
          borderRadius: { topLeft: 4, topRight: 4 },
          stack: 'regStack',
          yAxisID: 'y',
          order: 2,
          maxBarThickness: seriesChoice === 'ALL' ? 28 : 44,
        });
      }

      if (seriesChoice === 'ALL' || seriesChoice === 'HUB') {
        mDatasets.push({
          type: 'bar',
          label: 'Hub Transit GRW (Data Hub)',
          data: mHubGrw,
          backgroundColor: '#0d9488',
          stack: 'hubStack',
          yAxisID: 'y',
          order: 2,
          maxBarThickness: seriesChoice === 'ALL' ? 28 : 44,
        });
        mDatasets.push({
          type: 'bar',
          label: 'Hub Transit Customer (Data Hub Cust)',
          data: mHubCust,
          backgroundColor: '#7c3aed',
          borderRadius: { topLeft: 4, topRight: 4 },
          stack: 'hubStack',
          yAxisID: 'y',
          order: 2,
          maxBarThickness: seriesChoice === 'ALL' ? 28 : 44,
        });
      }

      mDatasets.push({
        type: 'line',
        label: 'Rata-Rata / Hari (' + (isCbm ? 'm³' : 'OD') + ')',
        data: mAvgDaily,
        borderColor: '#d97706',
        backgroundColor: '#ffffff',
        borderWidth: 2.5,
        pointRadius: 4,
        pointHoverRadius: 6,
        pointBorderColor: '#d97706',
        pointBorderWidth: 2,
        tension: 0.3,
        yAxisID: 'y1',
        order: 1,
      });

      charts.monthly = new window.Chart(mCanvas.getContext('2d'), {
        data: {
          labels: mLabels,
          datasets: mDatasets,
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          interaction: { mode: 'index', intersect: false },
          plugins: {
            legend: {
              position: 'top',
              labels: { boxWidth: 12, font: { family: 'Plus Jakarta Sans', size: 11, weight: '600' } },
            },
          },
          scales: {
            x: { stacked: true, grid: { display: false } },
            y: {
              stacked: true,
              position: 'left',
              beginAtZero: true,
              title: { display: true, text: 'Volume Bulanan (' + unitLabel + ')', font: { size: 11, weight: '600' } },
              grid: { color: 'rgba(148,163,184,0.16)' },
            },
            y1: {
              position: 'right',
              beginAtZero: true,
              title: { display: true, text: 'Rata-Rata / Hari', font: { size: 11, weight: '600' }, color: '#d97706' },
              grid: { drawOnChartArea: false },
            },
          },
        },
      });
    }

    // 2. Category Horizontal Bar Chart (Top 10)
    var cCanvas = document.getElementById('odsCategoryChart');
    if (cCanvas) {
      if (charts.category) charts.category.destroy();
      var sortedCats = comp.categoryList
        .slice()
        .sort(function (a, b) {
          return isCbm ? b.cbm - a.cbm : b.orders - a.orders;
        })
        .slice(0, 10);

      charts.category = new window.Chart(cCanvas.getContext('2d'), {
        type: 'bar',
        data: {
          labels: sortedCats.map(function (c) {
            return c.category;
          }),
          datasets: [
            {
              label: unitLabel,
              data: sortedCats.map(function (c) {
                return isCbm ? Math.round(c.cbm * 10) / 10 : c.orders;
              }),
              backgroundColor: sortedCats.map(function (c) {
                return c.sheetIdx === 0 ? '#2563eb' : c.sheetIdx === 1 ? '#0d9488' : '#7c3aed';
              }),
              borderRadius: 4,
              maxBarThickness: 22,
            },
          ],
        },
        options: {
          indexAxis: 'y',
          responsive: true,
          maintainAspectRatio: false,
          plugins: { legend: { display: false } },
          scales: {
            x: { beginAtZero: true, grid: { color: 'rgba(148,163,184,0.15)' } },
            y: { grid: { display: false }, ticks: { font: { size: 11, weight: '600' } } },
          },
        },
      });
    }

    // 3. Day-of-Week Average Load Chart (Mon -> Sun)
    var dowCanvas = document.getElementById('odsDowChart');
    if (dowCanvas) {
      if (charts.dow) charts.dow.destroy();
      var orderedDow = DOW_ORDER_MON_FIRST.map(function (idx) {
        return comp.dowAcc[idx];
      });

      charts.dow = new window.Chart(dowCanvas.getContext('2d'), {
        type: 'bar',
        data: {
          labels: orderedDow.map(function (d) {
            return d.name;
          }),
          datasets: [
            {
              label: 'Avg Regular / Hari',
              data: orderedDow.map(function (d) {
                return isCbm
                  ? Math.round((d.days > 0 ? ((d.cbm * (d.regOrders / Math.max(1, d.orders))) / d.days) : 0) * 10) / 10
                  : Math.round(d.avgRegOrders);
              }),
              backgroundColor: '#2563eb',
              stack: 'dow',
              maxBarThickness: 32,
            },
            {
              label: 'Avg Hub Transit / Hari',
              data: orderedDow.map(function (d) {
                return isCbm
                  ? Math.round((d.days > 0 ? ((d.cbm * (d.hubOrders / Math.max(1, d.orders))) / d.days) : 0) * 10) / 10
                  : Math.round(d.avgHubOrders);
              }),
              backgroundColor: '#0d9488',
              borderRadius: { topLeft: 4, topRight: 4 },
              stack: 'dow',
              maxBarThickness: 32,
            },
          ],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          interaction: { mode: 'index', intersect: false },
          plugins: {
            legend: { position: 'top', labels: { boxWidth: 11, font: { size: 11, weight: '600' } } },
          },
          scales: {
            x: { stacked: true, grid: { display: false } },
            y: { stacked: true, beginAtZero: true, grid: { color: 'rgba(148,163,184,0.15)' } },
          },
        },
      });
    }

    // 4. Daily Trend + MA-7 Chart
    var dCanvas = document.getElementById('odsDailyChart');
    if (dCanvas) {
      if (charts.daily) charts.daily.destroy();
      var dLabels = comp.dailyAsc.map(function (d) {
        return d.date.slice(8, 10) + '/' + d.date.slice(5, 7);
      });
      var dReg = comp.dailyAsc.map(function (d) {
        return isCbm ? Math.round(d.regCbm * 10) / 10 : d.regOrders;
      });
      var dHub = comp.dailyAsc.map(function (d) {
        return isCbm
          ? Math.round((d.hubGrwCbm + d.hubCustCbm) * 10) / 10
          : d.hubGrwOrders + d.hubCustOrders;
      });
      var dMa7 = comp.dailyAsc.map(function (d) {
        return isCbm ? Math.round(d.ma7Cbm * 10) / 10 : Math.round(d.ma7Orders);
      });

      charts.daily = new window.Chart(dCanvas.getContext('2d'), {
        data: {
          labels: dLabels,
          datasets: [
            {
              type: 'bar',
              label: 'OD Regular (H6)',
              data: dReg,
              backgroundColor: 'rgba(37, 99, 235, 0.78)',
              stack: 'day',
              order: 2,
            },
            {
              type: 'bar',
              label: 'Hub Transit (Hub + Hub Cust)',
              data: dHub,
              backgroundColor: 'rgba(13, 148, 136, 0.85)',
              stack: 'day',
              order: 2,
            },
            {
              type: 'line',
              label: 'Moving Average 7-Hari (MA-7)',
              data: dMa7,
              borderColor: '#dc2626',
              borderWidth: 2,
              pointRadius: 0,
              pointHoverRadius: 4,
              tension: 0.3,
              fill: false,
              order: 1,
            },
          ],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          interaction: { mode: 'index', intersect: false },
          plugins: {
            legend: { position: 'top', labels: { boxWidth: 12, font: { size: 11, weight: '600' } } },
          },
          scales: {
            x: { stacked: true, grid: { display: false }, ticks: { maxTicksLimit: 24, font: { size: 10 } } },
            y: { stacked: true, beginAtZero: true, grid: { color: 'rgba(148,163,184,0.15)' } },
          },
        },
      });
    }
  }

  function renderActiveDetailTab(comp) {
    var extra = document.getElementById('odsTabExtraControls');
    var area = document.getElementById('odsTabContentArea');
    if (!area || !extra) return;

    if (ODS_STATE.activeTab === 'monthly') {
      extra.innerHTML =
        '<span style="font-size:12px;color:#64748b;">Klik baris bulan untuk memfilter seluruh dashboard ke bulan tersebut</span>';
      renderMonthlyTable(comp, area);
    } else if (ODS_STATE.activeTab === 'category') {
      extra.innerHTML =
        '<span style="font-size:12px;color:#64748b;">Klik baris kategori untuk memfilter analisa spesifik per kategori</span>';
      renderCategoryTable(comp, area);
    } else if (ODS_STATE.activeTab === 'daily') {
      extra.innerHTML =
        '<input type="text" class="ods-input" placeholder="Cari tanggal (YYYY-MM-DD) / hari…" value="' +
        escHtml(ODS_STATE.dailySearch) +
        '" oninput="window.odsOnDailySearch(this.value)" style="width:210px;">' +
        '<select class="ods-select" onchange="window.odsOnDailyTypeFilter(this.value)">' +
        '  <option value="ALL"' +
        (ODS_STATE.dailyDayType === 'ALL' ? ' selected' : '') +
        '>Semua Hari</option>' +
        '  <option value="WEEKDAY"' +
        (ODS_STATE.dailyDayType === 'WEEKDAY' ? ' selected' : '') +
        '>Senin – Jumat</option>' +
        '  <option value="WEEKEND"' +
        (ODS_STATE.dailyDayType === 'WEEKEND' ? ' selected' : '') +
        '>Sabtu – Minggu</option>' +
        '  <option value="PEAK"' +
        (ODS_STATE.dailyDayType === 'PEAK' ? ' selected' : '') +
        '>Lonjakan Tinggi (&ge; 1.2x Avg)</option>' +
        '</select>';
      renderDailyTable(comp, area);
    } else {
      extra.innerHTML =
        '<span style="font-size:12px;color:#64748b;">Klik wilayah untuk memfilter koridor pengiriman</span>';
      renderRegionalAndOriginTables(comp, area);
    }
  }

  function renderMonthlyTable(comp, container) {
    if (!comp.monthlyAsc.length) {
      container.innerHTML = '<div style="padding:24px;text-align:center;color:#64748b;">Tidak ada data bulanan.</div>';
      return;
    }

    var rowsHtml = comp.monthlyAsc
      .map(function (m) {
        var momStr = '—';
        if (m.momDailyAvgPct !== null) {
          var col = m.momDailyAvgPct >= 0 ? '#16a34a' : '#dc2626';
          var sign = m.momDailyAvgPct >= 0 ? '+' : '';
          momStr = '<span style="color:' + col + ';font-weight:700;">' + sign + fmtPct(m.momDailyAvgPct, 1) + '</span>';
        }
        return (
          '<tr class="ods-clickable" onclick="window.odsOnMonthSelect(\'' +
          m.ym +
          '\')">' +
          '<td style="font-weight:700;">' +
          formatYmLabel(m.ym) +
          '</td>' +
          '<td class="num">' +
          fmtInt(m.activeDays) +
          '</td>' +
          '<td class="num ods-text-blue" style="font-weight:600;">' +
          fmtInt(m.regOrders) +
          '</td>' +
          '<td class="num ods-text-teal">' +
          fmtInt(m.hubGrwOrders) +
          '</td>' +
          '<td class="num ods-text-indigo">' +
          fmtInt(m.hubCustOrders) +
          '</td>' +
          '<td class="num" style="font-weight:700;">' +
          fmtInt(m.hubTotalOrders) +
          '</td>' +
          '<td class="num" style="font-weight:700;">' +
          fmtInt(m.orders) +
          '</td>' +
          '<td class="num" style="font-weight:700;">' +
          fmtInt(m.avgDailyOrders) +
          '</td>' +
          '<td class="num">' +
          fmtDec(m.cbm, 1) +
          '</td>' +
          '<td class="num">' +
          fmtDec(m.avgDailyCbm, 1) +
          '</td>' +
          '<td class="num">' +
          fmtPct(m.hubSharePct, 1) +
          '</td>' +
          '<td class="num">' +
          momStr +
          '</td>' +
          '<td>' +
          formatIsoToIdShort(m.peakDate) +
          ' <span class="ods-num" style="color:#64748b;">(' +
          fmtInt(m.peakOrders) +
          ')</span></td>' +
          '</tr>'
        );
      })
      .join('');

    var t = comp.totals;
    var hubAll = t.hubGrwOrders + t.hubCustOrders;

    container.innerHTML =
      '<div class="ods-table-scroll">' +
      '  <table class="ods-table">' +
      '    <thead>' +
      '      <tr>' +
      '        <th>Bulan</th>' +
      '        <th class="num">Hari Aktif</th>' +
      '        <th class="num">OD Regular (H6)</th>' +
      '        <th class="num">Hub GRW</th>' +
      '        <th class="num">Hub Cust</th>' +
      '        <th class="num">Subtotal Hub</th>' +
      '        <th class="num">Total OD Shipped</th>' +
      '        <th class="num">Avg OD / Hari</th>' +
      '        <th class="num">Total CBM (m³)</th>' +
      '        <th class="num">Avg CBM / Hari</th>' +
      '        <th class="num">% Porsi Hub</th>' +
      '        <th class="num">MoM (Avg/Hr)</th>' +
      '        <th>Puncak Harian</th>' +
      '      </tr>' +
      '    </thead>' +
      '    <tbody>' +
      rowsHtml +
      '    </tbody>' +
      '    <tfoot>' +
      '      <tr>' +
      '        <td>GRAND TOTAL / RATA-RATA</td>' +
      '        <td class="num">' +
      fmtInt(comp.activeDays) +
      '</td>' +
      '        <td class="num">' +
      fmtInt(t.regOrders) +
      '</td>' +
      '        <td class="num">' +
      fmtInt(t.hubGrwOrders) +
      '</td>' +
      '        <td class="num">' +
      fmtInt(t.hubCustOrders) +
      '</td>' +
      '        <td class="num">' +
      fmtInt(hubAll) +
      '</td>' +
      '        <td class="num">' +
      fmtInt(t.orders) +
      '</td>' +
      '        <td class="num">' +
      fmtInt(comp.avgDailyOrders) +
      '</td>' +
      '        <td class="num">' +
      fmtDec(t.cbm, 1) +
      '</td>' +
      '        <td class="num">' +
      fmtDec(comp.avgDailyCbm, 1) +
      '</td>' +
      '        <td class="num">' +
      fmtPct(t.orders > 0 ? (hubAll / t.orders) * 100 : 0, 1) +
      '</td>' +
      '        <td class="num">—</td>' +
      '        <td>' +
      (comp.peakDay ? formatIsoToIdShort(comp.peakDay.date) + ' (' + fmtInt(comp.peakDay.orders) + ')' : '—') +
      '</td>' +
      '      </tr>' +
      '    </tfoot>' +
      '  </table>' +
      '</div>';
  }

  function renderCategoryTable(comp, container) {
    var list = comp.categoryList.slice().sort(function (a, b) {
      var col = ODS_STATE.catSortCol;
      var va = a[col],
        vb = b[col];
      if (typeof va === 'string') return va.localeCompare(vb) * ODS_STATE.catSortDir;
      return (va - vb) * ODS_STATE.catSortDir;
    });

    if (!list.length) {
      container.innerHTML = '<div style="padding:24px;text-align:center;color:#64748b;">Tidak ada data kategori.</div>';
      return;
    }

    var rowsHtml = list
      .map(function (c, i) {
        var barColor = c.sheetIdx === 0 ? '#2563eb' : c.sheetIdx === 1 ? '#0d9488' : '#7c3aed';
        return (
          '<tr class="ods-clickable" onclick="window.odsSetCategory(\'' +
          escHtml(c.category).replace(/'/g, "\\'") +
          '\')">' +
          '<td class="num" style="color:#64748b;">' +
          (i + 1) +
          '</td>' +
          '<td style="font-weight:700;">' +
          escHtml(c.category) +
          '</td>' +
          '<td style="color:#475569;">' +
          escHtml(c.sourceSheet) +
          '</td>' +
          '<td style="color:#64748b;">' +
          escHtml(c.macro) +
          '</td>' +
          '<td class="num">' +
          fmtInt(c.dkOrders) +
          '</td>' +
          '<td class="num">' +
          fmtInt(c.lkOrders) +
          '</td>' +
          '<td class="num" style="font-weight:700;">' +
          fmtInt(c.orders) +
          '</td>' +
          '<td class="num">' +
          '  <div class="ods-bar-inline">' +
          '    <div class="ods-bar-track"><div class="ods-bar-fill" style="width:' +
          Math.min(100, c.shareOrdersPct).toFixed(1) +
          '%;background:' +
          barColor +
          ';"></div></div>' +
          '    <span>' +
          fmtPct(c.shareOrdersPct, 1) +
          '</span>' +
          '  </div>' +
          '</td>' +
          '<td class="num" style="font-weight:600;">' +
          fmtDec(c.cbm, 2) +
          '</td>' +
          '<td class="num">' +
          fmtPct(c.shareCbmPct, 1) +
          '</td>' +
          '<td class="num">' +
          fmtDec(c.avgDailyOrders, 1) +
          '</td>' +
          '<td class="num">' +
          fmtDec(c.avgCbmPerOrder, 3) +
          '</td>' +
          '</tr>'
        );
      })
      .join('');

    var t = comp.totals;
    container.innerHTML =
      '<div class="ods-table-scroll">' +
      '  <table class="ods-table">' +
      '    <thead>' +
      '      <tr>' +
      '        <th class="num">#</th>' +
      '        <th onclick="window.odsSortCategory(\'category\')">Kategori Order ⬍</th>' +
      '        <th onclick="window.odsSortCategory(\'sourceSheet\')">Sumber Sheet ⬍</th>' +
      '        <th onclick="window.odsSortCategory(\'macro\')">Kelompok Makro ⬍</th>' +
      '        <th class="num" onclick="window.odsSortCategory(\'dkOrders\')">DK (OD) ⬍</th>' +
      '        <th class="num" onclick="window.odsSortCategory(\'lkOrders\')">LK (OD) ⬍</th>' +
      '        <th class="num" onclick="window.odsSortCategory(\'orders\')">Total OD ⬍</th>' +
      '        <th class="num" onclick="window.odsSortCategory(\'shareOrdersPct\')">% Porsi OD ⬍</th>' +
      '        <th class="num" onclick="window.odsSortCategory(\'cbm\')">Total CBM (m³) ⬍</th>' +
      '        <th class="num" onclick="window.odsSortCategory(\'shareCbmPct\')">% Porsi CBM ⬍</th>' +
      '        <th class="num" onclick="window.odsSortCategory(\'avgDailyOrders\')">Avg OD/Hari ⬍</th>' +
      '        <th class="num" onclick="window.odsSortCategory(\'avgCbmPerOrder\')">Avg CBM/OD ⬍</th>' +
      '      </tr>' +
      '    </thead>' +
      '    <tbody>' +
      rowsHtml +
      '    </tbody>' +
      '    <tfoot>' +
      '      <tr>' +
      '        <td colspan="4">GRAND TOTAL</td>' +
      '        <td class="num">' +
      fmtInt(t.dkOrders) +
      '</td>' +
      '        <td class="num">' +
      fmtInt(t.lkOrders) +
      '</td>' +
      '        <td class="num">' +
      fmtInt(t.orders) +
      '</td>' +
      '        <td class="num">100,0%</td>' +
      '        <td class="num">' +
      fmtDec(t.cbm, 2) +
      '</td>' +
      '        <td class="num">100,0%</td>' +
      '        <td class="num">' +
      fmtDec(comp.avgDailyOrders, 1) +
      '</td>' +
      '        <td class="num">' +
      fmtDec(comp.avgCbmPerOrder, 3) +
      '</td>' +
      '      </tr>' +
      '    </tfoot>' +
      '  </table>' +
      '</div>';
  }

  function renderDailyTable(comp, container) {
    var q = (ODS_STATE.dailySearch || '').toLowerCase().trim();
    var avg = comp.avgDailyOrders || 1;

    var filtered = comp.dailyAsc.filter(function (d) {
      var dayName = DOW_NAMES_ID[d.dow];
      if (q) {
        var hay = (d.date + ' ' + formatIsoToIdShort(d.date) + ' ' + dayName).toLowerCase();
        if (hay.indexOf(q) === -1) return false;
      }
      if (ODS_STATE.dailyDayType === 'WEEKDAY' && (d.dow === 0 || d.dow === 6)) return false;
      if (ODS_STATE.dailyDayType === 'WEEKEND' && d.dow !== 0 && d.dow !== 6) return false;
      if (ODS_STATE.dailyDayType === 'PEAK' && d.orders < avg * 1.2) return false;
      return true;
    });

    filtered.sort(function (a, b) {
      var col = ODS_STATE.dailySortCol;
      var va = col === 'hubTotal' ? a.hubGrwOrders + a.hubCustOrders : a[col];
      var vb = col === 'hubTotal' ? b.hubGrwOrders + b.hubCustOrders : b[col];
      if (typeof va === 'string') return va.localeCompare(vb) * ODS_STATE.dailySortDir;
      return (va - vb) * ODS_STATE.dailySortDir;
    });

    var totalRows = filtered.length;
    var totalPages = Math.max(1, Math.ceil(totalRows / ODS_STATE.dailyPageSize));
    if (ODS_STATE.dailyPage > totalPages) ODS_STATE.dailyPage = totalPages;
    var startIdx = (ODS_STATE.dailyPage - 1) * ODS_STATE.dailyPageSize;
    var pageItems = filtered.slice(startIdx, startIdx + ODS_STATE.dailyPageSize);

    var rowsHtml = pageItems
      .map(function (d) {
        var hubTot = d.hubGrwOrders + d.hubCustOrders;
        var ratio = avg > 0 ? d.orders / avg : 0;
        var loadLabel = 'Normal';
        var loadColor = '#16a34a';
        if (ratio >= 1.35) {
          loadLabel = 'Peak Surge (' + fmtDec(ratio, 2) + 'x)';
          loadColor = '#dc2626';
        } else if (ratio >= 1.15) {
          loadLabel = 'High Load (' + fmtDec(ratio, 2) + 'x)';
          loadColor = '#d97706';
        } else {
          loadLabel = 'Normal (' + fmtDec(ratio, 2) + 'x)';
        }

        return (
          '<tr>' +
          '<td class="ods-num" style="font-weight:700;">' +
          d.date +
          '</td>' +
          '<td>' +
          DOW_NAMES_ID[d.dow] +
          '</td>' +
          '<td class="num">' +
          fmtInt(d.regDk) +
          '</td>' +
          '<td class="num">' +
          fmtInt(d.regLk) +
          '</td>' +
          '<td class="num ods-text-blue" style="font-weight:600;">' +
          fmtInt(d.regOrders) +
          '</td>' +
          '<td class="num ods-text-teal">' +
          fmtInt(d.hubGrwOrders) +
          '</td>' +
          '<td class="num ods-text-indigo">' +
          fmtInt(d.hubCustOrders) +
          '</td>' +
          '<td class="num" style="font-weight:600;">' +
          fmtInt(hubTot) +
          '</td>' +
          '<td class="num" style="font-weight:700;">' +
          fmtInt(d.orders) +
          '</td>' +
          '<td class="num">' +
          fmtDec(d.cbm, 2) +
          '</td>' +
          '<td style="color:' +
          loadColor +
          ';font-weight:600;">' +
          loadLabel +
          '</td>' +
          '</tr>'
        );
      })
      .join('');

    container.innerHTML =
      '<div class="ods-table-scroll">' +
      '  <table class="ods-table">' +
      '    <thead>' +
      '      <tr>' +
      '        <th onclick="window.odsSortDaily(\'date\')">Tanggal ⬍</th>' +
      '        <th>Hari</th>' +
      '        <th class="num">Reg DK</th>' +
      '        <th class="num">Reg LK</th>' +
      '        <th class="num" onclick="window.odsSortDaily(\'regOrders\')">Subtotal Regular ⬍</th>' +
      '        <th class="num" onclick="window.odsSortDaily(\'hubGrwOrders\')">Hub GRW ⬍</th>' +
      '        <th class="num" onclick="window.odsSortDaily(\'hubCustOrders\')">Hub Cust ⬍</th>' +
      '        <th class="num" onclick="window.odsSortDaily(\'hubTotal\')">Subtotal Hub ⬍</th>' +
      '        <th class="num" onclick="window.odsSortDaily(\'orders\')">Total OD ⬍</th>' +
      '        <th class="num" onclick="window.odsSortDaily(\'cbm\')">Total CBM (m³) ⬍</th>' +
      '        <th>Indeks vs Avg Harian</th>' +
      '      </tr>' +
      '    </thead>' +
      '    <tbody>' +
      (rowsHtml ||
        '<tr><td colspan="11" style="text-align:center;padding:24px;color:#64748b;">Tidak ada tanggal sesuai pencarian.</td></tr>') +
      '    </tbody>' +
      '  </table>' +
      '</div>' +
      '<div class="ods-pagination">' +
      '  <div>Menampilkan <span class="ods-num">' +
      (totalRows > 0 ? startIdx + 1 : 0) +
      '–' +
      Math.min(startIdx + ODS_STATE.dailyPageSize, totalRows) +
      '</span> dari <strong class="ods-num">' +
      fmtInt(totalRows) +
      '</strong> tanggal aktif</div>' +
      '  <div style="display:flex;align-items:center;gap:8px;">' +
      '    <button type="button" class="ods-btn" onclick="window.odsChangeDailyPage(-1)"' +
      (ODS_STATE.dailyPage <= 1 ? ' disabled style="opacity:0.45;cursor:not-allowed;"' : '') +
      '>Sebelumnya</button>' +
      '    <span class="ods-num" style="font-weight:600;">Hal ' +
      ODS_STATE.dailyPage +
      ' / ' +
      totalPages +
      '</span>' +
      '    <button type="button" class="ods-btn" onclick="window.odsChangeDailyPage(1)"' +
      (ODS_STATE.dailyPage >= totalPages ? ' disabled style="opacity:0.45;cursor:not-allowed;"' : '') +
      '>Berikutnya</button>' +
      '  </div>' +
      '</div>';
  }

  function renderRegionalAndOriginTables(comp, container) {
    var topWil = comp.wilayahList.slice(0, 20);
    var wilRows = topWil
      .map(function (w, idx) {
        return (
          '<tr class="ods-clickable" onclick="window.odsSetWilayah(\'' +
          escHtml(w.wilayah).replace(/'/g, "\\'") +
          '\')">' +
          '<td class="num" style="color:#64748b;">' +
          (idx + 1) +
          '</td>' +
          '<td style="font-weight:700;">' +
          escHtml(w.wilayah) +
          '</td>' +
          '<td class="num ods-text-blue">' +
          fmtInt(w.regOrders) +
          '</td>' +
          '<td class="num ods-text-teal">' +
          fmtInt(w.hubGrwOrders) +
          '</td>' +
          '<td class="num ods-text-indigo">' +
          fmtInt(w.hubCustOrders) +
          '</td>' +
          '<td class="num" style="font-weight:700;">' +
          fmtInt(w.orders) +
          '</td>' +
          '<td class="num">' +
          fmtPct(w.shareOrdersPct, 1) +
          '</td>' +
          '<td class="num" style="font-weight:600;">' +
          fmtDec(w.cbm, 1) +
          '</td>' +
          '<td class="num">' +
          fmtDec(w.avgCbmPerOrder, 2) +
          '</td>' +
          '</tr>'
        );
      })
      .join('');

    var origRows = comp.originList
      .map(function (o) {
        return (
          '<tr>' +
          '<td style="font-weight:700;">' +
          escHtml(o.origin) +
          '</td>' +
          '<td class="num" style="font-weight:700;">' +
          fmtInt(o.orders) +
          '</td>' +
          '<td class="num">' +
          fmtPct(o.sharePct, 1) +
          '</td>' +
          '<td class="num">' +
          fmtDec(o.cbm, 1) +
          '</td>' +
          '<td class="num ods-text-green" style="font-weight:600;">' +
          fmtPct(o.slaPct, 2) +
          '</td>' +
          '</tr>'
        );
      })
      .join('');

    container.innerHTML =
      '<div class="ods-split-tables">' +
      '  <div>' +
      '    <div style="font-size:13px;font-weight:700;margin-bottom:8px;">Top 20 Wilayah Tujuan (OD Regular + Hub Transit)</div>' +
      '    <div class="ods-table-scroll">' +
      '      <table class="ods-table">' +
      '        <thead>' +
      '          <tr>' +
      '            <th class="num">#</th>' +
      '            <th>Wilayah</th>' +
      '            <th class="num">OD Regular</th>' +
      '            <th class="num">Hub GRW</th>' +
      '            <th class="num">Hub Cust</th>' +
      '            <th class="num">Total OD</th>' +
      '            <th class="num">% OD</th>' +
      '            <th class="num">Total CBM</th>' +
      '            <th class="num">CBM/OD</th>' +
      '          </tr>' +
      '        </thead>' +
      '        <tbody>' +
      (wilRows || '<tr><td colspan="9" style="text-align:center;padding:20px;">Tidak ada data wilayah.</td></tr>') +
      '        </tbody>' +
      '      </table>' +
      '    </div>' +
      '  </div>' +
      '  <div>' +
      '    <div style="font-size:13px;font-weight:700;margin-bottom:8px;">Asal Gudang Booking Site (Hub Transit Customer)</div>' +
      '    <div class="ods-table-scroll">' +
      '      <table class="ods-table">' +
      '        <thead>' +
      '          <tr>' +
      '            <th>Booking Site Origin</th>' +
      '            <th class="num">Total OD</th>' +
      '            <th class="num">% Share</th>' +
      '            <th class="num">CBM (m³)</th>' +
      '            <th class="num">SLA On-Time</th>' +
      '          </tr>' +
      '        </thead>' +
      '        <tbody>' +
      (origRows ||
        '<tr><td colspan="5" style="text-align:center;padding:20px;color:#64748b;">Pilih stream Semua atau Hub Customer untuk melihat asal Booking Site.</td></tr>') +
      '        </tbody>' +
      '      </table>' +
      '    </div>' +
      '  </div>' +
      '</div>';
  }

  function renderOdShippedView() {
    if (!ODS_STATE.cube) {
      loadOdShippedDataset(false);
      return;
    }
    mountOdShippedShell();
    syncFilterControls();
    recomputeAndRender();
  }

  // Interactive Global Handlers
  window.odsSetStream = function (stream) {
    ODS_STATE.stream = stream;
    ODS_STATE.dailyPage = 1;
    syncFilterControls();
    recomputeAndRender();
  };

  window.odsSetMetric = function (metric) {
    ODS_STATE.metric = metric;
    syncFilterControls();
    recomputeAndRender();
  };

  window.odsSetMonthlySeries = function (series) {
    ODS_STATE.monthlySeries = series || 'ALL';
    syncFilterControls();
    if (ODS_STATE.lastComputed) {
      renderAllCharts(ODS_STATE.lastComputed);
    }
  };

  window.odsSetArea = function (area) {
    ODS_STATE.area = area;
    ODS_STATE.dailyPage = 1;
    syncFilterControls();
    recomputeAndRender();
  };

  window.odsSetCategory = function (cat) {
    ODS_STATE.category = cat || 'ALL';
    ODS_STATE.dailyPage = 1;
    syncFilterControls();
    recomputeAndRender();
  };

  window.odsSetWilayah = function (wil) {
    ODS_STATE.wilayah = wil || 'ALL';
    ODS_STATE.dailyPage = 1;
    syncFilterControls();
    recomputeAndRender();
  };

  window.odsOnMonthSelect = function (ym) {
    ODS_STATE.month = ym || 'ALL';
    if (ym && ym !== 'ALL' && ODS_STATE.cube) {
      var matching = ODS_STATE.cube.dicts.dates.filter(function (d) {
        return d.slice(0, 7) === ym;
      });
      if (matching.length) {
        ODS_STATE.startDate = matching[0];
        ODS_STATE.endDate = matching[matching.length - 1];
      }
      ODS_STATE.preset = 'CUSTOM';
    } else if (ODS_STATE.cube && ODS_STATE.cube.dicts.dates.length) {
      ODS_STATE.startDate = ODS_STATE.cube.dicts.dates[0];
      ODS_STATE.endDate = ODS_STATE.cube.dicts.dates[ODS_STATE.cube.dicts.dates.length - 1];
      ODS_STATE.preset = 'ALL';
    }
    ODS_STATE.dailyPage = 1;
    syncFilterControls();
    recomputeAndRender();
  };

  window.odsOnDateChange = function () {
    var sIn = document.getElementById('odsStartDate');
    var eIn = document.getElementById('odsEndDate');
    if (sIn) ODS_STATE.startDate = sIn.value;
    if (eIn) ODS_STATE.endDate = eIn.value;
    ODS_STATE.month = 'ALL';
    ODS_STATE.preset = 'CUSTOM';
    ODS_STATE.dailyPage = 1;
    syncFilterControls();
    recomputeAndRender();
  };

  window.odsSetPreset = function (preset) {
    if (!ODS_STATE.cube || !ODS_STATE.cube.dicts.dates.length) return;
    var dates = ODS_STATE.cube.dicts.dates;
    var maxIso = dates[dates.length - 1];
    var minIso = dates[0];
    ODS_STATE.preset = preset;
    ODS_STATE.month = 'ALL';

    if (preset === 'ALL') {
      ODS_STATE.startDate = minIso;
      ODS_STATE.endDate = maxIso;
    } else if (preset === 'THIS_MONTH') {
      var curYm = maxIso.slice(0, 7);
      ODS_STATE.month = curYm;
      var mDates = dates.filter(function (d) {
        return d.slice(0, 7) === curYm;
      });
      ODS_STATE.startDate = mDates[0] || maxIso;
      ODS_STATE.endDate = mDates[mDates.length - 1] || maxIso;
    } else if (preset === 'PREV_MONTH') {
      var p = maxIso.split('-');
      var dt = new Date(parseInt(p[0], 10), parseInt(p[1], 10) - 2, 1);
      var prevYm = dt.getFullYear() + '-' + String(dt.getMonth() + 1).padStart(2, '0');
      var pmDates = dates.filter(function (d) {
        return d.slice(0, 7) === prevYm;
      });
      if (pmDates.length) {
        ODS_STATE.month = prevYm;
        ODS_STATE.startDate = pmDates[0];
        ODS_STATE.endDate = pmDates[pmDates.length - 1];
      }
    } else {
      var daysBack = preset === '7D' ? 6 : 29;
      var ep = maxIso.split('-');
      var endObj = new Date(parseInt(ep[0], 10), parseInt(ep[1], 10) - 1, parseInt(ep[2], 10));
      endObj.setDate(endObj.getDate() - daysBack);
      ODS_STATE.startDate =
        endObj.getFullYear() +
        '-' +
        String(endObj.getMonth() + 1).padStart(2, '0') +
        '-' +
        String(endObj.getDate()).padStart(2, '0');
      ODS_STATE.endDate = maxIso;
    }

    ODS_STATE.dailyPage = 1;
    syncFilterControls();
    recomputeAndRender();
  };

  window.odsResetFilters = function () {
    if (!ODS_STATE.cube) return;
    var dates = ODS_STATE.cube.dicts.dates;
    ODS_STATE.stream = 'ALL';
    ODS_STATE.area = 'ALL';
    ODS_STATE.category = 'ALL';
    ODS_STATE.wilayah = 'ALL';
    ODS_STATE.month = 'ALL';
    ODS_STATE.preset = 'ALL';
    ODS_STATE.dailySearch = '';
    ODS_STATE.dailyDayType = 'ALL';
    ODS_STATE.dailyPage = 1;
    if (dates.length) {
      ODS_STATE.startDate = dates[0];
      ODS_STATE.endDate = dates[dates.length - 1];
    }
    syncFilterControls();
    recomputeAndRender();
  };

  window.odsSwitchTab = function (tab) {
    ODS_STATE.activeTab = tab;
    syncFilterControls();
    if (ODS_STATE.lastComputed) {
      renderActiveDetailTab(ODS_STATE.lastComputed);
    }
  };

  window.odsOnDailySearch = function (val) {
    ODS_STATE.dailySearch = val || '';
    ODS_STATE.dailyPage = 1;
    if (ODS_STATE.lastComputed) {
      var area = document.getElementById('odsTabContentArea');
      if (area) renderDailyTable(ODS_STATE.lastComputed, area);
    }
  };

  window.odsOnDailyTypeFilter = function (val) {
    ODS_STATE.dailyDayType = val || 'ALL';
    ODS_STATE.dailyPage = 1;
    if (ODS_STATE.lastComputed) {
      var area = document.getElementById('odsTabContentArea');
      if (area) renderDailyTable(ODS_STATE.lastComputed, area);
    }
  };

  window.odsSortDaily = function (col) {
    if (ODS_STATE.dailySortCol === col) ODS_STATE.dailySortDir *= -1;
    else {
      ODS_STATE.dailySortCol = col;
      ODS_STATE.dailySortDir = -1;
    }
    if (ODS_STATE.lastComputed) {
      var area = document.getElementById('odsTabContentArea');
      if (area) renderDailyTable(ODS_STATE.lastComputed, area);
    }
  };

  window.odsSortCategory = function (col) {
    if (ODS_STATE.catSortCol === col) ODS_STATE.catSortDir *= -1;
    else {
      ODS_STATE.catSortCol = col;
      ODS_STATE.catSortDir = -1;
    }
    if (ODS_STATE.lastComputed) {
      var area = document.getElementById('odsTabContentArea');
      if (area) renderCategoryTable(ODS_STATE.lastComputed, area);
    }
  };

  window.odsChangeDailyPage = function (delta) {
    ODS_STATE.dailyPage = Math.max(1, ODS_STATE.dailyPage + delta);
    if (ODS_STATE.lastComputed) {
      var area = document.getElementById('odsTabContentArea');
      if (area) renderDailyTable(ODS_STATE.lastComputed, area);
    }
  };

  window.odsRefreshLive = function () {
    loadOdShippedDataset(true);
  };

  window.odsExportActiveCsv = function () {
    var comp = ODS_STATE.lastComputed;
    if (!comp) return;

    var rows = [];
    var filename = 'Laporan_OD_Shipped_';

    if (ODS_STATE.activeTab === 'monthly') {
      filename += 'Bulanan.csv';
      rows.push([
        'Bulan',
        'Hari Aktif',
        'OD Regular (Data H6)',
        'Hub GRW (Data Hub)',
        'Hub Cust (Data Hub Cust)',
        'Total Hub Transit',
        'Total OD Shipped',
        'Avg OD/Hari',
        'Total CBM',
        'Avg CBM/Hari',
        'Porsi Hub (%)',
        'Tanggal Puncak',
        'OD Puncak',
      ]);
      comp.monthlyAsc.forEach(function (m) {
        rows.push([
          m.ym,
          m.activeDays,
          m.regOrders,
          m.hubGrwOrders,
          m.hubCustOrders,
          m.hubTotalOrders,
          m.orders,
          m.avgDailyOrders.toFixed(1),
          m.cbm.toFixed(2),
          m.avgDailyCbm.toFixed(2),
          m.hubSharePct.toFixed(2),
          m.peakDate,
          m.peakOrders,
        ]);
      });
    } else if (ODS_STATE.activeTab === 'category') {
      filename += 'Per_Kategori.csv';
      rows.push([
        'Kategori Order',
        'Sumber Sheet',
        'Kelompok Makro',
        'DK OD',
        'LK OD',
        'Total OD',
        'Share OD (%)',
        'Total CBM',
        'Share CBM (%)',
        'Avg OD/Hari',
        'Avg CBM/OD',
      ]);
      comp.categoryList.forEach(function (c) {
        rows.push([
          '"' + c.category.replace(/"/g, '""') + '"',
          c.sourceSheet,
          '"' + c.macro.replace(/"/g, '""') + '"',
          c.dkOrders,
          c.lkOrders,
          c.orders,
          c.shareOrdersPct.toFixed(2),
          c.cbm.toFixed(2),
          c.shareCbmPct.toFixed(2),
          c.avgDailyOrders.toFixed(2),
          c.avgCbmPerOrder.toFixed(3),
        ]);
      });
    } else {
      filename += 'Per_Tanggal.csv';
      rows.push([
        'Tanggal',
        'Hari',
        'Regular DK',
        'Regular LK',
        'Subtotal OD Regular',
        'Hub GRW',
        'Hub Customer',
        'Subtotal Hub Transit',
        'Total OD Shipped',
        'Total CBM',
      ]);
      comp.dailyAsc.forEach(function (d) {
        rows.push([
          d.date,
          DOW_NAMES_ID[d.dow],
          d.regDk,
          d.regLk,
          d.regOrders,
          d.hubGrwOrders,
          d.hubCustOrders,
          d.hubGrwOrders + d.hubCustOrders,
          d.orders,
          d.cbm.toFixed(2),
        ]);
      });
    }

    var csvText = rows
      .map(function (r) {
        return r.join(',');
      })
      .join('\n');
    var blob = new Blob([csvText], { type: 'text/csv;charset=utf-8;' });
    var link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // Wire into host dashboard navigation & global Refresh button
  function hookDashboardNavigation() {
    var origNavTo = window.navTo;
    if (typeof origNavTo === 'function' && !origNavTo.__odsHooked) {
      var wrappedNavTo = function (page) {
        if (page === 'od-shipped') {
          window.activePage = 'od-shipped';
          document.querySelectorAll('.ni').forEach(function (el) {
            el.classList.remove('ac');
          });
          var ni = document.getElementById('ni-od-shipped');
          if (ni) ni.classList.add('ac');

          document.querySelectorAll('.mobile-bottom-nav .nav-item').forEach(function (el) {
            el.classList.remove('active');
          });

          document.querySelectorAll('.pg').forEach(function (el) {
            el.classList.remove('vis');
          });
          var pg = document.getElementById('pg-od-shipped');
          if (pg) pg.classList.add('vis');

          var hdrTitle = document.getElementById('pageHeaderTitle');
          var hdrSub = document.getElementById('pageHeaderSub');
          if (hdrTitle) hdrTitle.textContent = 'TOTAL OD SHIPPED & HUB TRANSIT ANALYTICS';
          if (hdrSub) {
            hdrSub.textContent =
              'Analisa total pengiriman OD Regular (Data H6) & Hub Transit (Data Hub & Data Hub Cust) · NDC Sidoarjo';
          }

          var btnCap = document.getElementById('btnCaptureInterfaceOrder');
          if (btnCap) btnCap.style.display = 'none';

          var sb = document.getElementById('sb');
          if (sb && sb.classList.contains('mobile-open')) {
            sb.classList.remove('mobile-open');
            var overlay = document.getElementById('sidebar-overlay');
            if (overlay) {
              overlay.style.opacity = '0';
              setTimeout(function () {
                overlay.style.display = 'none';
              }, 300);
            }
          }

          renderOdShippedView();
          return;
        }
        return origNavTo.apply(this, arguments);
      };
      wrappedNavTo.__odsHooked = true;
      window.navTo = wrappedNavTo;
    }

    var origLoadData = window.loadData;
    if (typeof origLoadData === 'function' && !origLoadData.__odsHooked) {
      var wrappedLoadData = function () {
        if (window.activePage === 'od-shipped') {
          loadOdShippedDataset(true);
        }
        return origLoadData.apply(this, arguments);
      };
      wrappedLoadData.__odsHooked = true;
      window.loadData = wrappedLoadData;
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', hookDashboardNavigation);
  } else {
    hookDashboardNavigation();
  }
})();
