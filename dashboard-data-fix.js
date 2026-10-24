/* ==========================================================================
   HCI DASHBOARD DATA RELIABILITY & PERFORMANCE PATCH
   Fixes:
   1. HTML response detection in fetchAndParseCsv so static/SPA fallback
      automatically switches to direct Google Sheets CSV without failing.
   2. Non-blocking two-stage loadData() so 21 fast sheets render immediately
      while the 9.5 MB Fulfillment Armada history loads in parallel.
   3. Complete onDataReady() page refresh coverage across all sidebar menus.
   4. Overview Map markers loader via resilient fetchAndParseCsv.
   5. Interface Order (dsReport) empty future template row filtering.
   6. Monitoring Portal CX proxy routing + "DD - MM - YYYY" Timestamp parser.
   ========================================================================== */

(function () {
  'use strict';

  var proxyUnavailable = false;
  var forceBypassCache = false;
  var csvTextCache = new Map();
  var csvInFlight = new Map();
  var CSV_CACHE_TTL_MS = 90000;

  function looksLikeHtml(text) {
    if (!text) return false;
    var head = text.slice(0, 512).trim().toLowerCase();
    return (
      head.indexOf('<!doctype') === 0 ||
      head.indexOf('<html') === 0 ||
      head.indexOf('<head') === 0 ||
      head.indexOf('<body') === 0 ||
      head.indexOf('accounts.google.com') !== -1
    );
  }

  // Override getProxyUrl to skip /api/sheet-proxy immediately once known unavailable
  window.getProxyUrl = function (originalUrl) {
    if (!originalUrl) return '';
    var host = window.location.hostname || '';
    var isStaticHost =
      proxyUnavailable ||
      host.indexOf('github.io') !== -1 ||
      window.location.protocol === 'file:' ||
      !host;
    if (isStaticHost) {
      return originalUrl;
    }
    var suffix = forceBypassCache ? '&refresh=1' : '';
    return '/api/sheet-proxy?url=' + encodeURIComponent(originalUrl) + suffix;
  };

  function extractOriginalSheetUrl(url) {
    if (!url) return '';
    if (url.indexOf('/api/sheet-proxy?url=') === 0) {
      var q = url.substring('/api/sheet-proxy?url='.length);
      var ampIdx = q.indexOf('&');
      if (ampIdx !== -1) q = q.substring(0, ampIdx);
      try {
        return decodeURIComponent(q);
      } catch (_e) {
        return q;
      }
    }
    return url;
  }

  function fetchTextWithTimeout(targetUrl, timeoutMs) {
    var controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    var timer = controller
      ? setTimeout(function () {
          controller.abort();
        }, timeoutMs || 28000)
      : null;

    return fetch(targetUrl, controller ? { signal: controller.signal } : undefined)
      .then(function (res) {
        if (!res.ok) {
          throw new Error('HTTP ' + res.status);
        }
        var ct = (res.headers.get('content-type') || '').toLowerCase();
        return res.text().then(function (txt) {
          if (ct.indexOf('text/html') !== -1 || looksLikeHtml(txt)) {
            throw new Error('HTML response received instead of CSV');
          }
          return txt;
        });
      })
      .finally(function () {
        if (timer) clearTimeout(timer);
      });
  }

  function fetchCsvTextResilient(url) {
    var canonicalKey = extractOriginalSheetUrl(url);
    var now = Date.now();

    if (!forceBypassCache && csvTextCache.has(canonicalKey)) {
      var cached = csvTextCache.get(canonicalKey);
      if (cached && cached.expiresAt > now) {
        return Promise.resolve(cached.text);
      }
    }

    if (csvInFlight.has(canonicalKey)) {
      return csvInFlight.get(canonicalKey);
    }

    var isProxyReq = url.indexOf('/api/sheet-proxy?url=') === 0;
    var effectivePrimaryUrl = isProxyReq && proxyUnavailable ? canonicalKey : url;

    var reqPromise = fetchTextWithTimeout(effectivePrimaryUrl, 28000)
      .catch(function (err) {
        if (isProxyReq && effectivePrimaryUrl !== canonicalKey) {
          // Proxy endpoint unavailable or returned SPA HTML -> switch to direct Google Sheets mode
          if (
            err &&
            err.message &&
            (err.message.indexOf('HTML response') !== -1 || err.message.indexOf('HTTP 404') !== -1)
          ) {
            proxyUnavailable = true;
          }
          return fetchTextWithTimeout(canonicalKey, 30000);
        }
        // Single retry after short backoff for direct URL transient network hiccups
        return new Promise(function (r) {
          setTimeout(r, 600);
        }).then(function () {
          return fetchTextWithTimeout(canonicalKey, 30000);
        });
      })
      .then(function (text) {
        csvTextCache.set(canonicalKey, {
          text: text,
          expiresAt: Date.now() + CSV_CACHE_TTL_MS,
        });
        return text;
      })
      .finally(function () {
        csvInFlight.delete(canonicalKey);
      });

    csvInFlight.set(canonicalKey, reqPromise);
    return reqPromise;
  }

  // Harden global fetchAndParseCsv used across all dashboard sheets
  window.fetchAndParseCsv = function (url, options, resolveCallback) {
    fetchCsvTextResilient(url)
      .then(function (text) {
        window.Papa.parse(
          text,
          Object.assign({}, options, {
            download: false,
            complete: function (results) {
              resolveCallback((results && results.data) || []);
            },
            error: function () {
              resolveCallback([]);
            },
          })
        );
      })
      .catch(function (err) {
        console.warn('[HCI Data Loader] Sheet gagal dimuat:', extractOriginalSheetUrl(url), err.message);
        resolveCallback([]);
      });
  };

  // Wrap onDataReady so ALL pages (including Fulfillment Armada, Case ID Release, Risk Control, Interface Order, Portal CX, OD Shipped) refresh seamlessly
  var origOnDataReady = window.onDataReady;
  window.onDataReady = function (updatedTime, isLive) {
    if (typeof origOnDataReady === 'function') {
      origOnDataReady(updatedTime, isLive);
    }
    if (window.activePage === 'fulfillment-armada' && typeof window.renderFulfillmentArmadaPage === 'function') {
      window.renderFulfillmentArmadaPage();
    } else if (window.activePage === 'caseid-release' && typeof window.renderCaseIdReleasePage === 'function') {
      window.renderCaseIdReleasePage();
    } else if (window.activePage === 'risk-control' && typeof window.renderRiskControlPage === 'function') {
      window.renderRiskControlPage();
    } else if (window.activePage === 'interface-order' && typeof window.renderInterfaceOrderPage === 'function') {
      window.renderInterfaceOrderPage();
    } else if (window.activePage === 'monitoring-portal' && typeof window.renderMonitoringPortalPage === 'function') {
      window.renderMonitoringPortalPage();
    } else if (window.activePage === 'od-shipped' && typeof window.openOdShippedPage === 'function') {
      window.openOdShippedPage();
    }
  };

  function safePromise(p, fallbackVal) {
    return Promise.resolve(p).catch(function (e) {
      console.warn('[HCI Data Loader] Sub-sheet fallback:', e);
      return fallbackVal;
    });
  }

  // Optimized non-blocking two-stage loadData()
  window.loadData = function (isManualRefresh) {
    if (isManualRefresh) {
      forceBypassCache = true;
      csvTextCache.clear();
    }

    var btn = document.getElementById('btnRefresh');
    if (btn) {
      btn.disabled = true;
      btn.textContent = '⟳ Memuat...';
    }
    var tblLoading = document.getElementById('tableLoading');
    var tblEmpty = document.getElementById('tableEmpty');
    var dataTbl = document.getElementById('dataTable');
    var lastUpd = document.getElementById('lastUpdate');
    if (tblLoading && (!window.allData || window.allData.length === 0)) tblLoading.style.display = 'flex';
    if (tblEmpty && (!window.allData || window.allData.length === 0)) tblEmpty.style.display = 'none';
    if (dataTbl && (!window.allData || window.allData.length === 0)) dataTbl.style.display = 'none';
    if (lastUpd) lastUpd.textContent = '⟳ Menghubungi server...';

    var loadWatchdog = setTimeout(function () {
      var tblLd = document.getElementById('tableLoading');
      if (tblLd && tblLd.style.display !== 'none') {
        console.warn('[HCI Data Loader] Loading watchdog triggered — force rendering UI.');
        tblLd.style.display = 'none';
        var dTb = document.getElementById('dataTable');
        if (dTb) dTb.style.display = 'table';
        if ((!window.allData || window.allData.length === 0) && typeof window.fallbackData === 'function') {
          window.fallbackData();
        } else if (typeof window.onDataReady === 'function') {
          window.onDataReady(new Date().toLocaleTimeString('id-ID'), true);
        }
      }
    }, 4500);

    var gp = window.getProxyUrl;
    var csvMonitoringUrl = gp('https://docs.google.com/spreadsheets/d/1ITpX4yc_VLL_qpbLZc1RHfwDzinUf2vnbQXewb_F4oM/gviz/tq?tqx=out:csv');
    var csvAgingUrl = gp('https://docs.google.com/spreadsheets/d/1ITpX4yc_VLL_qpbLZc1RHfwDzinUf2vnbQXewb_F4oM/gviz/tq?tqx=out:csv&sheet=OUTSTANDING%20GRW');
    var csvAgingCustUrl = gp('https://docs.google.com/spreadsheets/d/1ITpX4yc_VLL_qpbLZc1RHfwDzinUf2vnbQXewb_F4oM/gviz/tq?tqx=out:csv&sheet=OUTSTANDING%20CUST');
    var csvContDateUrl = gp('https://docs.google.com/spreadsheets/d/1ITpX4yc_VLL_qpbLZc1RHfwDzinUf2vnbQXewb_F4oM/gviz/tq?tqx=out:csv&sheet=CONT%20DATE');
    var csvFulfillmentUrl = gp('https://docs.google.com/spreadsheets/d/1bEBI18zlEeXDqg4G4sFljZETceLvsyP-fcuMB1nLtsM/gviz/tq?tqx=out:csv&sheet=Data');
    var csvFulfillmentFallbackUrl = gp('https://docs.google.com/spreadsheets/d/1bEBI18zlEeXDqg4G4sFljZETceLvsyP-fcuMB1nLtsM/gviz/tq?tqx=out:csv&gid=0');
    var csvOlfUrl = gp('https://docs.google.com/spreadsheets/d/1q-qxELBQZr3ABhVg-mw6Kvhl-e11RGQUmCTQjsXtz9g/gviz/tq?tqx=out:csv&sheet=OLF');
    var csvCaseIdReleaseUrl = gp('https://docs.google.com/spreadsheets/d/1MpFVzgYBAT00HFZNMi_chgdTKU3rnMTBGOYFKspncwk/gviz/tq?tqx=out:csv&gid=0');
    var csvCaseIdReleaseP1Url = gp('https://docs.google.com/spreadsheets/d/1MpFVzgYBAT00HFZNMi_chgdTKU3rnMTBGOYFKspncwk/gviz/tq?tqx=out:csv&gid=2036255569');
    var csvCaseIdReleaseP2Url = gp('https://docs.google.com/spreadsheets/d/1MpFVzgYBAT00HFZNMi_chgdTKU3rnMTBGOYFKspncwk/gviz/tq?tqx=out:csv&gid=552992544');
    var csvCaseIdReleaseHubLkUrl = gp('https://docs.google.com/spreadsheets/d/1MpFVzgYBAT00HFZNMi_chgdTKU3rnMTBGOYFKspncwk/gviz/tq?tqx=out:csv&gid=362212909');
    var csvCaseIdReleaseLpUrl = gp('https://docs.google.com/spreadsheets/d/1MpFVzgYBAT00HFZNMi_chgdTKU3rnMTBGOYFKspncwk/gviz/tq?tqx=out:csv&gid=1480106733');
    var csvCaseIdReleaseQcSkusUrl = gp('https://docs.google.com/spreadsheets/d/1MpFVzgYBAT00HFZNMi_chgdTKU3rnMTBGOYFKspncwk/gviz/tq?tqx=out:csv&gid=1387841996');

    var csvOdSuspendUrl = gp('https://docs.google.com/spreadsheets/d/1BbfYhsVU2khVjv6-jzrlHPiTYMga92RZKgl-stkpA-8/gviz/tq?tqx=out:csv&gid=284586222');
    var csvOdSuspendFallbackUrl = gp('https://docs.google.com/spreadsheets/d/1BbfYhsVU2khVjv6-jzrlHPiTYMga92RZKgl-stkpA-8/export?format=csv&gid=284586222');
    var csvOdSuspendInformaUrl = gp('https://docs.google.com/spreadsheets/d/1BbfYhsVU2khVjv6-jzrlHPiTYMga92RZKgl-stkpA-8/gviz/tq?tqx=out:csv&gid=61959361');
    var csvOdSuspendIeUrl = gp('https://docs.google.com/spreadsheets/d/1BbfYhsVU2khVjv6-jzrlHPiTYMga92RZKgl-stkpA-8/gviz/tq?tqx=out:csv&gid=2008893209');
    var csvOdSuspendSelmaUrl = gp('https://docs.google.com/spreadsheets/d/1BbfYhsVU2khVjv6-jzrlHPiTYMga92RZKgl-stkpA-8/gviz/tq?tqx=out:csv&gid=561706811');

    var csvSlaGrwUrl = gp('https://docs.google.com/spreadsheets/d/1q-qxELBQZr3ABhVg-mw6Kvhl-e11RGQUmCTQjsXtz9g/gviz/tq?tqx=out:csv&sheet=SLA%20GRW');
    var csvSlaCustUrl1 = gp('https://docs.google.com/spreadsheets/d/1q-qxELBQZr3ABhVg-mw6Kvhl-e11RGQUmCTQjsXtz9g/gviz/tq?tqx=out:csv&sheet=SLA%20CUST');
    var csvSlaCustUrl2 = gp('https://docs.google.com/spreadsheets/d/1q-qxELBQZr3ABhVg-mw6Kvhl-e11RGQUmCTQjsXtz9g/gviz/tq?tqx=out:csv&sheet=SLA%20CUSTOMER');
    var csvSlaRecapUrl = gp('https://docs.google.com/spreadsheets/d/1q-qxELBQZr3ABhVg-mw6Kvhl-e11RGQUmCTQjsXtz9g/gviz/tq?tqx=out:csv&sheet=' + encodeURIComponent('RECAP DK &LK'));
    var csvSlaRecapUrl2 = gp('https://docs.google.com/spreadsheets/d/1q-qxELBQZr3ABhVg-mw6Kvhl-e11RGQUmCTQjsXtz9g/gviz/tq?tqx=out:csv&sheet=' + encodeURIComponent('RECAP DK & LK'));
    var csvSlaRecapUrl3 = gp('https://docs.google.com/spreadsheets/d/1q-qxELBQZr3ABhVg-mw6Kvhl-e11RGQUmCTQjsXtz9g/gviz/tq?tqx=out:csv&gid=831591956');
    var csvBacklogUrl = gp('https://docs.google.com/spreadsheets/d/1ITpX4yc_VLL_qpbLZc1RHfwDzinUf2vnbQXewb_F4oM/gviz/tq?tqx=out:csv&sheet=BACKLOG');
    var csvOrgChartUrl = gp('https://docs.google.com/spreadsheets/d/1ITpX4yc_VLL_qpbLZc1RHfwDzinUf2vnbQXewb_F4oM/gviz/tq?tqx=out:csv&gid=1501777569');
    var csvAgingReasonUrl = gp('https://docs.google.com/spreadsheets/d/1ITpX4yc_VLL_qpbLZc1RHfwDzinUf2vnbQXewb_F4oM/gviz/tq?tqx=out:csv&gid=532307905');

    // Reset forceBypassCache after building URLs
    forceBypassCache = false;

    function pCsv(u, opts) {
      return new Promise(function (resolve) {
        window.fetchAndParseCsv(u, opts, resolve);
      });
    }

    var fetchOdSuspend = pCsv(csvOdSuspendUrl, { header: false, skipEmptyLines: true }).then(function (d) {
      if (d && d.length > 0) return d;
      return pCsv(csvOdSuspendFallbackUrl, { header: false, skipEmptyLines: true });
    });

    var fetchSlaCust = pCsv(csvSlaCustUrl1, { header: false, skipEmptyLines: true }).then(function (data) {
      var isValid = false;
      if (data && data.length > 0 && data[0]) {
        for (var c = 0; c < Math.min(5, data[0].length); c++) {
          if (data[0][c] && String(data[0][c]).toUpperCase().indexOf('TGL') !== -1) {
            isValid = true;
            break;
          }
        }
      }
      if (isValid) return data;
      return pCsv(csvSlaCustUrl2, { header: false, skipEmptyLines: true }).then(function (data2) {
        return data2 && data2.length > 0 ? data2 : data;
      });
    });

    var fetchSlaRecap = pCsv(csvSlaRecapUrl3, { header: false, skipEmptyLines: true }).then(function (d3) {
      function ok(d) {
        return d && d.length > 1 && d[0] && d[0].some(function (c) { return /DK|LK|DALAM KOTA|LUAR KOTA/i.test(String(c)); });
      }
      if (ok(d3)) return d3;
      return pCsv(csvSlaRecapUrl, { header: false, skipEmptyLines: true }).then(function (d1) {
        if (ok(d1)) return d1;
        return pCsv(csvSlaRecapUrl2, { header: false, skipEmptyLines: true }).then(function (d2) {
          return ok(d2) ? d2 : d3 || [];
        });
      });
    });

    var fetchOlf = pCsv(csvOlfUrl, { header: false, skipEmptyLines: true }).then(function (d) {
      return typeof window.parseOlfSheet === 'function' ? window.parseOlfSheet(d) : [];
    });

    var fetchQcSkus = pCsv(csvCaseIdReleaseQcSkusUrl, { header: false, skipEmptyLines: true }).then(function (d) {
      if (d && d.length > 1) return d;
      return typeof window.getCRFallbackQcSkusData === 'function' ? window.getCRFallbackQcSkusData() : [];
    });

    // Start heavy 9.5MB Fulfillment sheet in parallel WITHOUT blocking initial dashboard render
    var fulfillmentResolvedRows = window.allFulfillmentData && window.allFulfillmentData.length > 1 ? window.allFulfillmentData : [];
    var stage1Completed = false;

    var fetchFulfillmentBg = pCsv(csvFulfillmentUrl, { header: true, skipEmptyLines: true })
      .then(function (data) {
        var rows = typeof window.parseFulfillmentDetailSheet === 'function' ? window.parseFulfillmentDetailSheet(data) : [];
        if (rows && rows.length > 0) return rows;
        return pCsv(csvFulfillmentFallbackUrl, { header: true, skipEmptyLines: true }).then(function (data2) {
          return typeof window.parseFulfillmentDetailSheet === 'function' ? window.parseFulfillmentDetailSheet(data2) : [];
        });
      })
      .then(function (rows) {
        if (rows && rows.length > 0) {
          fulfillmentResolvedRows = rows;
          window.allFulfillmentData = rows;
          if (stage1Completed) {
            if (window.activePage === 'fulfillment-armada' && typeof window.renderFulfillmentArmadaPage === 'function') {
              window.renderFulfillmentArmadaPage();
            } else if (window.activePage === 'armada' && typeof window.renderPerformanceArmada === 'function') {
              window.renderPerformanceArmada();
            } else if (window.activePage === 'caseid-release' && typeof window.renderCaseIdReleasePage === 'function') {
              window.renderCaseIdReleasePage();
            } else if (window.activePage === 'overview' && typeof window.renderOverviewPage === 'function') {
              window.renderOverviewPage();
            }
            if (typeof window.updateKpiTicker === 'function') {
              window.updateKpiTicker();
            }
          }
        }
        return rows;
      })
      .catch(function (err) {
        console.warn('[HCI Data Loader] Fulfillment Armada sheet error:', err);
        return [];
      });

    // Stage 1: Fast core sheets
    Promise.all([
      safePromise(pCsv(csvMonitoringUrl, { header: true, skipEmptyLines: true }), []), // 0
      safePromise(pCsv(csvAgingUrl, { header: true, skipEmptyLines: true }), []), // 1
      safePromise(pCsv(csvAgingCustUrl, { header: true, skipEmptyLines: true }), []), // 2
      safePromise(pCsv(csvContDateUrl, { header: true, skipEmptyLines: true }), []), // 3
      safePromise(pCsv(csvSlaGrwUrl, { header: false, skipEmptyLines: true }), []), // 4
      safePromise(fetchSlaCust, []), // 5
      Promise.resolve(fulfillmentResolvedRows), // 6 (populated immediately if cached, or updated seamlessly by fetchFulfillmentBg)
      safePromise(fetchOlf, []), // 7
      safePromise(pCsv(csvCaseIdReleaseUrl, { header: false, skipEmptyLines: true }), []), // 8
      safePromise(pCsv(csvCaseIdReleaseP1Url, { header: false, skipEmptyLines: true }), []), // 9
      safePromise(pCsv(csvCaseIdReleaseP2Url, { header: false, skipEmptyLines: true }), []), // 10
      safePromise(pCsv(csvCaseIdReleaseHubLkUrl, { header: false, skipEmptyLines: true }), []), // 11
      safePromise(pCsv(csvCaseIdReleaseLpUrl, { header: false, skipEmptyLines: true }), []), // 12
      safePromise(pCsv(csvBacklogUrl, { header: true, skipEmptyLines: true }), []), // 13
      safePromise(pCsv(csvOrgChartUrl, { header: true, skipEmptyLines: true }), []), // 14
      safePromise(pCsv(csvAgingReasonUrl, { header: true, skipEmptyLines: true }), []), // 15
      safePromise(fetchSlaRecap, []), // 16
      safePromise(fetchQcSkus, []), // 17
      safePromise(fetchOdSuspend, []), // 18
      safePromise(pCsv(csvOdSuspendInformaUrl, { header: false, skipEmptyLines: true }), []), // 19
      safePromise(pCsv(csvOdSuspendIeUrl, { header: false, skipEmptyLines: true }), []), // 20
      safePromise(pCsv(csvOdSuspendSelmaUrl, { header: false, skipEmptyLines: true }), []), // 21
    ])
      .then(function (results) {
        if (fulfillmentResolvedRows && fulfillmentResolvedRows.length > 0) {
          results[6] = fulfillmentResolvedRows;
        }

        window.allSlaGrwData = results[4] || [];
        window.allSlaCustData = results[5] || [];
        window.allSlaRecapDkLkData = results[16] || [];
        window.allFulfillmentData = results[6] || [];
        window.allOlfData = (results[7] || []).filter(function (r) {
          return r && typeof r === 'object' && Object.keys(r).length > 0;
        });
        window.allCaseIdReleaseData = results[8] || [];
        window.allCaseIdReleaseP1Data = results[9] || [];
        window.allCaseIdReleaseP2Data = results[10] || [];
        window.allCaseIdReleaseHubLkData = results[11] || [];
        window.allCaseIdReleaseLpData = results[12] || [];
        window.allCaseIdReleaseQcSkusData =
          results[17] && results[17].length > 1
            ? results[17]
            : typeof window.getCRFallbackQcSkusData === 'function'
              ? window.getCRFallbackQcSkusData()
              : [];

        window.allBacklogRawData = results[13] || [];
        if (typeof window.parseBacklogSheetData === 'function') {
          window.allBacklogData = window.parseBacklogSheetData(window.allBacklogRawData);
        }
        window.allOrgChartRawData = results[14] || [];
        if (typeof window.parseOrgChartSheetData === 'function') {
          window.allOrgChartData = window.parseOrgChartSheetData(window.allOrgChartRawData);
        }
        window.allAgingReasonRawData = results[15] || [];
        if (typeof window.parseOdSuspendSheetData === 'function') {
          window.allOdSuspendRawData = results[18] || [];
          window.allOdSuspendData = window.parseOdSuspendSheetData(window.allOdSuspendRawData);
          window.allOdSuspendInformaRawData = results[19] || [];
          window.allOdSuspendInformaData = window.parseOdSuspendSheetData(window.allOdSuspendInformaRawData);
          window.allOdSuspendIeRawData = results[20] || [];
          window.allOdSuspendIeData = window.parseOdSuspendSheetData(window.allOdSuspendIeRawData);
          window.allOdSuspendSelmaRawData = results[21] || [];
          window.allOdSuspendSelmaData = window.parseOdSuspendSheetData(window.allOdSuspendSelmaRawData);
        }
        if (typeof window.parseAgingReasonSheetData === 'function') {
          window.allAgingReasonData = window.parseAgingReasonSheetData(window.allAgingReasonRawData);
        }
        if (typeof window.populateAgingReasonFilterDropdowns === 'function') {
          window.populateAgingReasonFilterDropdowns();
        }
        if (typeof window.renderAgingReasonSection === 'function') {
          window.renderAgingReasonSection();
        }
        window.isCaseIdReleaseFetchedFromSheets = true;

        // Discover dynamic SLA Customer Missed log URL from SLA CUST sheet header cells
        var targetUrl = null;
        if (window.allSlaCustData && window.allSlaCustData.length > 0) {
          var foundMatch = null;
          for (var r = 0; r < Math.min(5, window.allSlaCustData.length); r++) {
            var rowCells = window.allSlaCustData[r];
            if (!rowCells) continue;
            for (var c = 0; c < rowCells.length; c++) {
              var cellStr = String(rowCells[c] || '');
              if (cellStr.indexOf('docs.google.com/spreadsheets/d/') !== -1) {
                foundMatch = cellStr;
                break;
              }
            }
            if (foundMatch) break;
          }
          if (foundMatch) {
            var m = foundMatch.match(/https:\/\/docs\.google\.com\/spreadsheets\/d\/([^\/\s\?\"\'#]+)/);
            if (m) {
              var spreadsheetId = m[1];
              var gidMatch = foundMatch.match(/[?&]gid=(\d+)/) || foundMatch.match(/#gid=(\d+)/);
              var gid = gidMatch ? gidMatch[1] : '0';
              targetUrl = 'https://docs.google.com/spreadsheets/d/' + spreadsheetId + '/gviz/tq?tqx=out:csv&gid=' + gid;
            }
          }
        }

        var finalGrwMissedUrl = gp('https://docs.google.com/spreadsheets/d/1PklbBrPhF8myX5ONshtYKzTT4WACMXsbViH1LdDXACU/gviz/tq?tqx=out:csv&gid=1680256105');
        var finalCustMissedUrl = gp(targetUrl || 'https://docs.google.com/spreadsheets/d/1PklbBrPhF8myX5ONshtYKzTT4WACMXsbViH1LdDXACU/gviz/tq?tqx=out:csv&gid=0');

        return Promise.all([
          safePromise(pCsv(finalGrwMissedUrl, { header: false, skipEmptyLines: true }), []),
          safePromise(pCsv(finalCustMissedUrl, { header: false, skipEmptyLines: true }), []),
        ]).then(function (missedResults) {
          window.allSlaGrwMissedData = missedResults[0] || [];
          window.allSlaCustMissedData = missedResults[1] || [];
          if (fulfillmentResolvedRows && fulfillmentResolvedRows.length > 0) {
            results[6] = fulfillmentResolvedRows;
          }
          clearTimeout(loadWatchdog);
          stage1Completed = true;
          window.processResults(results);
        });
      })
      .catch(function (err) {
        clearTimeout(loadWatchdog);
        console.error('[HCI Data Loader] Gagal memuat core data:', err);
        if (typeof window.fallbackData === 'function') window.fallbackData();
      });

    // Ensure background fulfillment promise is referenced
    void fetchFulfillmentBg;
  };

  // Wire Refresh button to pass manual refresh flag so cache refreshes cleanly
  document.addEventListener('DOMContentLoaded', function () {
    var btn = document.getElementById('btnRefresh');
    if (btn) {
      btn.onclick = function () {
        window.loadData(true);
      };
    }
  });

  // ── FIX OVERVIEW MAP MARKERS LOADER (uses resilient fetchAndParseCsv) ──
  window.loadMapMarkersFromSpreadsheet = function () {
    var spreadsheetUrl = window.getProxyUrl(
      'https://docs.google.com/spreadsheets/d/1apHi3pK7HvL7oOLIpE5NofACpn6TU_aHE9TSHr7vT3A/gviz/tq?tqx=out:csv'
    );
    window.fetchAndParseCsv(spreadsheetUrl, { header: true, skipEmptyLines: true }, function (rows) {
      if (!rows || !rows.length || !window.L || !window.mapInstance) return;

      if (Array.isArray(window.mapMarkers)) {
        window.mapMarkers.forEach(function (m) {
          if (window.mapInstance) window.mapInstance.removeLayer(m);
        });
      }
      window.mapMarkers = [];

      var hubCount = 0;
      var whCount = 0;
      var dkCount = 0;
      var lkCount = 0;
      var lpCount = 0;
      var validMarkers = [];

      rows.forEach(function (row) {
        var area = String(row['AREA'] || '').trim().toUpperCase();
        var name = String(row['Nama'] || row['NAMA'] || '').trim();
        var lat = parseFloat(row['Latitude'] || row['LATITUDE']);
        var lng = parseFloat(row['Longitude'] || row['LONGITUDE']);

        if (!isNaN(lat) && !isNaN(lng)) {
          var type = 'lk';
          var label = 'Luar Kota';
          if (area === 'WH' || area === 'WAREHOUSE' || name.toUpperCase().indexOf('WH') !== -1 || name.toUpperCase().indexOf('WAREHOUSE') !== -1) {
            type = 'wh';
            label = 'Warehouse / WH';
            whCount++;
          } else if (area === '' || name.toUpperCase().indexOf('NDC') !== -1 || area === 'HUB' || area === 'PUSAT') {
            type = 'hub';
            label = 'Pusat Hub / NDC';
            hubCount++;
          } else if (area === 'DK' || area === 'DALAM KOTA') {
            type = 'dk';
            label = 'Dalam Kota';
            dkCount++;
          } else if (area === 'LK' || area === 'LUAR KOTA') {
            type = 'lk';
            label = 'Luar Kota';
            lkCount++;
          } else if (area === 'LP' || area === 'LUAR PULAU') {
            type = 'lp';
            label = 'Luar Pulau';
            lpCount++;
          } else {
            type = 'lk';
            label = 'Luar Kota / Wilayah Lain';
            lkCount++;
          }
          validMarkers.push({ name: name, lat: lat, lng: lng, type: type, label: label, areaCode: area });
        }
      });

      var startPt = window.userStartPoint || [-7.4478, 112.7183];
      var pulseIconHtml = window.hasUserGeolocation
        ? '<div class="pulse-ring"></div><div class="pulse-dot"></div>'
        : '<div class="pulse-ring" style="border-color:#e2573e;"></div><div class="pulse-dot" style="background:#e2573e;"></div>';

      var pulseIcon = window.L.divIcon({
        className: 'user-pulse-icon',
        html: pulseIconHtml,
        iconSize: [20, 20],
        iconAnchor: [10, 10],
      });

      var startMarker = window.L.marker(startPt, { icon: pulseIcon }).addTo(window.mapInstance);
      startMarker.bindPopup("<strong style='color:var(--text);font-family:sans-serif;font-size:13px;'>NDC HCI SIDOARJO</strong>");
      window.mapMarkers.push(startMarker);

      validMarkers.forEach(function (m) {
        if (!window.mapInstance) return;
        var col = '#3b95ff';
        if (m.type === 'hub') col = '#e2573e';
        else if (m.type === 'wh') col = '#7c3aed';
        else if (m.type === 'dk') col = '#79af97';
        else if (m.type === 'lp') col = '#f59e0b';

        var radius = m.type === 'hub' || m.type === 'wh' ? 10 : 7;
        var marker = window.L.circleMarker([m.lat, m.lng], {
          radius: radius,
          fillColor: col,
          color: '#ffffff',
          weight: 1.5,
          fillOpacity: 0.85,
        }).addTo(window.mapInstance);

        var safeName = typeof window.escHtml === 'function' ? window.escHtml(m.name) : m.name;
        var safeLabel = typeof window.escHtml === 'function' ? window.escHtml(m.label) : m.label;
        marker.bindPopup(
          "<strong style='color:var(--text);font-family:sans-serif;font-size:12px;'>" +
            safeName +
            "</strong><br><span style='color:var(--muted);font-size:11px;'>Tipe: <strong style='color:var(--text);'>" +
            m.type.toUpperCase() +
            '</strong> (' +
            safeLabel +
            ')</span>'
        );
        window.mapMarkers.push(marker);

        if (Math.abs(startPt[0] - m.lat) > 0.0001 || Math.abs(startPt[1] - m.lng) > 0.0001) {
          var baseLine = window.L.polyline([startPt, [m.lat, m.lng]], {
            color: col,
            weight: 1.5,
            opacity: 0.25,
            className: 'glowing-line-base',
          }).addTo(window.mapInstance);
          window.mapMarkers.push(baseLine);

          var flowLine = window.L.polyline([startPt, [m.lat, m.lng]], {
            color: '#ffffff',
            weight: 2,
            className: 'flowing-light',
          }).addTo(window.mapInstance);
          window.mapMarkers.push(flowLine);
        }
      });

      if (window.mapInstance && validMarkers.length > 0) {
        var boundsPoints = [startPt];
        validMarkers.forEach(function (m) {
          boundsPoints.push([m.lat, m.lng]);
        });
        window.mapBoundsStore = window.L.latLngBounds(boundsPoints);
        setTimeout(function () {
          if (window.mapInstance) {
            window.mapInstance.invalidateSize();
            window.mapInstance.fitBounds(window.mapBoundsStore, { padding: [25, 25] });
          }
        }, 100);
      }

      if (typeof window.setText === 'function') {
        window.setText('ovMapTotal', validMarkers.length);
        window.setText('ovMapHub', hubCount);
        window.setText('ovMapWh', whCount);
        window.setText('ovMapDk', dkCount);
        window.setText('ovMapLk', lkCount);
        window.setText('ovMapLp', lpCount);
      }
    });
  };

  // ── FIX INTERFACE ORDER (exclude blank future template rows in dsReport) ──
  window.fetchInterfaceOrderData = function () {
    var tbodyWms = document.getElementById('ioTypeOrderTableBody');
    var tbodySto = document.getElementById('ioStoTableBody');
    var tbodyArea = document.getElementById('ioAreaTableBody');

    if (tbodyWms) tbodyWms.innerHTML = '<tr><td colspan="7" style="text-align: center; padding: 24px; color: var(--ts);">⟳ Memuat data interface wms...</td></tr>';
    if (tbodySto) tbodySto.innerHTML = '<tr><td colspan="5" style="text-align: center; padding: 20px; color: var(--ts);">⟳ Memuat STO GRW...</td></tr>';
    if (tbodyArea) tbodyArea.innerHTML = '<tr><td colspan="3" style="text-align: center; padding: 20px; color: var(--ts);">⟳ Memuat sheet SEBARAN AREA STORING...</td></tr>';

    var wmsUrl = window.getProxyUrl('https://docs.google.com/spreadsheets/d/1ITpX4yc_VLL_qpbLZc1RHfwDzinUf2vnbQXewb_F4oM/gviz/tq?tqx=out:csv&gid=192612710');
    var pvotUrl = window.getProxyUrl('https://docs.google.com/spreadsheets/d/1ITpX4yc_VLL_qpbLZc1RHfwDzinUf2vnbQXewb_F4oM/gviz/tq?tqx=out:csv&gid=1258463016');
    var dsReportUrl = window.getProxyUrl('https://docs.google.com/spreadsheets/d/1ITpX4yc_VLL_qpbLZc1RHfwDzinUf2vnbQXewb_F4oM/gviz/tq?tqx=out:csv&gid=155620981');

    var loadedCount = 0;
    function checkDone() {
      loadedCount++;
      if (loadedCount >= 3 && typeof window.processAndRenderInterfaceOrder === 'function') {
        window.processAndRenderInterfaceOrder();
      }
    }

    window.fetchAndParseCsv(wmsUrl, { header: true, skipEmptyLines: true }, function (data) {
      window.ioInterfaceWmsData = data || [];
      checkDone();
    });

    window.fetchAndParseCsv(pvotUrl, { header: true, skipEmptyLines: true }, function (data) {
      window.ioPvotAreaData = data || [];
      checkDone();
    });

    window.fetchAndParseCsv(dsReportUrl, { header: true, skipEmptyLines: true }, function (data) {
      if (data && data.length > 0) {
        var parsedData = [];
        var sampleKeys = Object.keys(data[0] || {});
        var kDate = window.findKey_(sampleKeys, ['PERIODE', 'DATE', 'TANGGAL']) || sampleKeys[0];
        var kDem = window.findKey_(sampleKeys, ['DEMAND IN', 'DEMAND_IN']) || sampleKeys[1];
        var kShip = window.findKey_(sampleKeys, ['SHIPMENT OUT', 'SHIPMENT_OUT']) || sampleKeys[2];
        var kBack = window.findKey_(sampleKeys, ['BACKLOG']) || sampleKeys[3];
        var kNol = window.findKey_(sampleKeys, ['SHIPMENT NOL', 'SHIPMENT_NOL', 'NOL']) || sampleKeys[4];

        function cleanNum(v) {
          if (v === null || v === undefined || String(v).trim() === '') return 0;
          var n = parseFloat(String(v).replace(/,/g, '').trim());
          return isNaN(n) ? 0 : n;
        }

        data.forEach(function (row) {
          var dateRaw = kDate ? row[kDate] : '';
          if (!dateRaw) return;

          var rawDemStr = kDem !== undefined && row[kDem] !== undefined ? String(row[kDem]).trim() : '';
          var rawShipStr = kShip !== undefined && row[kShip] !== undefined ? String(row[kShip]).trim() : '';
          var rawBackStr = kBack !== undefined && row[kBack] !== undefined ? String(row[kBack]).trim() : '';
          var rawNolStr = kNol !== undefined && row[kNol] !== undefined ? String(row[kNol]).trim() : '';

          // Skip future calendar template rows where all operational metrics are blank
          if (rawDemStr === '' && rawShipStr === '' && rawBackStr === '' && rawNolStr === '') {
            return;
          }

          var dateStr = String(dateRaw).trim();
          if (dateStr.indexOf('/') !== -1) {
            var parts = dateStr.split('/');
            if (parts.length === 3 && parts[2].length === 4) {
              var p0 = parseInt(parts[0], 10);
              var p1 = parseInt(parts[1], 10);
              var mo = p0 > 12 ? p1 : p0;
              var dy = p0 > 12 ? p0 : p1;
              dateStr = parts[2] + '-' + String(mo).padStart(2, '0') + '-' + String(dy).padStart(2, '0');
            }
          }

          parsedData.push({
            date: dateStr,
            demandIn: cleanNum(rawDemStr),
            shipmentOut: cleanNum(rawShipStr),
            backlog: cleanNum(rawBackStr),
            nol: cleanNum(rawNolStr),
          });
        });

        if (parsedData.length > 0) {
          window.ioDsRawDailyData = parsedData;
          if (typeof window.setDsDefaultDateInputs === 'function') {
            window.setDsDefaultDateInputs(true);
          }
        }
      }
      checkDone();
    });
  };

  // ── FIX MONITORING PORTAL CX (proxy + "DD - MM - YYYY HH:mm:ss" Timestamp parser) ──
  function normalizeCxTimestampToIso(rawTs) {
    if (!rawTs) return '';
    var s = String(rawTs).trim();
    if (!s) return '';

    // Match "24 - 10 - 2026 07:40:04" or "2026 - 10 - 24" or "24/10/2026"
    var m = s.match(/^(\d{1,4})\s*[-\/]\s*(\d{1,2})\s*[-\/]\s*(\d{1,4})/);
    if (m) {
      var a = parseInt(m[1], 10);
      var b = parseInt(m[2], 10);
      var c = parseInt(m[3], 10);
      if (!isNaN(a) && !isNaN(b) && !isNaN(c)) {
        var yr, mo, dy;
        if (m[1].length === 4) {
          yr = a;
          mo = b;
          dy = c;
        } else {
          yr = c < 100 ? 2000 + c : c;
          // Indonesian Portal CX format uses DD - MM - YYYY (e.g. "24 - 10 - 2026")
          if (s.indexOf(' - ') !== -1) {
            dy = a;
            mo = b;
          } else if (a > 12) {
            dy = a;
            mo = b;
          } else if (b > 12) {
            mo = a;
            dy = b;
          } else {
            dy = a;
            mo = b;
          }
        }
        if (yr >= 2020 && mo >= 1 && mo <= 12 && dy >= 1 && dy <= 31) {
          return yr + '-' + String(mo).padStart(2, '0') + '-' + String(dy).padStart(2, '0');
        }
      }
    }
    return '';
  }

  window.fetchMonitoringPortalData = function () {
    var tbodyCat = document.getElementById('cxCategoryTableBody');
    var tbodyRej = document.getElementById('cxRejectedTableBody');

    if (tbodyCat) tbodyCat.innerHTML = '<tr><td colspan="5" style="text-align: center; padding: 24px; color: var(--ts);">⟳ Memuat data portal CX...</td></tr>';
    if (tbodyRej) tbodyRej.innerHTML = '<tr><td colspan="3" style="text-align: center; padding: 24px; color: var(--ts);">⟳ Memuat data portal CX...</td></tr>';

    var cxUrl = window.getProxyUrl(
      'https://docs.google.com/spreadsheets/d/1vpYq040_6iyN0ft8Pjm-m9ZlL9sX-t4eNV89ngaKZGs/gviz/tq?tqx=out:csv&gid=0'
    );

    window.fetchAndParseCsv(cxUrl, { header: true, skipEmptyLines: true }, function (data) {
      if (data && data.length > 0) {
        window.cxPortalData = data;
        window.processAndRenderMonitoringPortal();
      } else {
        if (tbodyCat) tbodyCat.innerHTML = '<tr><td colspan="5" style="text-align: center; padding: 24px; color: var(--ts);">❌ Gagal memuat data / Data kosong.</td></tr>';
        if (tbodyRej) tbodyRej.innerHTML = '<tr><td colspan="3" style="text-align: center; padding: 24px; color: var(--ts);">❌ Gagal memuat data / Data kosong.</td></tr>';
      }
    });
  };

  window.processAndRenderMonitoringPortal = function () {
    var totalDone = 0;
    var totalWaiting = 0;
    var totalRejected = 0;
    var datesWithDone = new Set();
    var dailyStats = {};
    var categories = {};
    var rejectedList = [];

    (window.cxPortalData || []).forEach(function (row) {
      var jsonStr = row['DC Responsible Detail JSON'];
      if (!jsonStr) return;

      var ndcObj = null;
      try {
        var arr = JSON.parse(String(jsonStr).trim());
        if (Array.isArray(arr)) {
          for (var i = 0; i < arr.length; i++) {
            if (arr[i] && arr[i].name && String(arr[i].name).toUpperCase().indexOf('NDC SIDOARJO') !== -1) {
              ndcObj = arr[i];
              break;
            }
          }
        }
      } catch (_e) {
        if (String(jsonStr).toUpperCase().indexOf('NDC SIDOARJO') !== -1) {
          ndcObj = {
            name: 'NDC Sidoarjo',
            status: row['Status DC Responsible'] || '',
            note: row['Keterangan DC Responsible'] || '',
          };
        }
      }

      if (!ndcObj) return;

      var stat = String(ndcObj.status || '').trim().toUpperCase();
      var note = String(ndcObj.note || '').trim().toUpperCase();
      var catStr = String(row['Kategori Request'] || '').trim() || 'TIDAK DIKETAHUI';

      var isDone = stat.indexOf('DONE') !== -1 || note.indexOf('DONE') !== -1;
      var isRejected = stat.indexOf('REJECTED') !== -1 || note.indexOf('REJECTED') !== -1;
      var isoDate = normalizeCxTimestampToIso(row['Timestamp']);

      if (isoDate) {
        if (!dailyStats[isoDate]) {
          dailyStats[isoDate] = { date: isoDate, total: 0, done: 0, rejected: 0, waiting: 0 };
        }
        dailyStats[isoDate].total++;
        if (isDone) dailyStats[isoDate].done++;
        else if (isRejected) dailyStats[isoDate].rejected++;
        else dailyStats[isoDate].waiting++;
      }

      if (isDone) {
        totalDone++;
        if (isoDate) datesWithDone.add(isoDate);
      } else if (isRejected) {
        totalRejected++;
        rejectedList.push({
          id: row['ID Request'] || '-',
          cat: catStr,
          reason: ndcObj.note || ndcObj.status || '-',
        });
      } else {
        totalWaiting++;
      }

      catStr.split('|').forEach(function (c) {
        var cat = c.trim() || 'TIDAK DIKETAHUI';
        if (!categories[cat]) {
          categories[cat] = { done: 0, waiting: 0, rejected: 0, total: 0, datesWithDone: new Set() };
        }
        categories[cat].total++;
        if (isDone) {
          categories[cat].done++;
          if (isoDate) categories[cat].datesWithDone.add(isoDate);
        } else if (isRejected) {
          categories[cat].rejected++;
        } else {
          categories[cat].waiting++;
        }
      });
    });

    var avgDone = datesWithDone.size > 0 ? Math.round(totalDone / datesWithDone.size) : totalDone;
    window.setTxt('cxKpiDone', window.fn(totalDone));
    window.setTxt('cxKpiWaiting', window.fn(totalWaiting));
    window.setTxt('cxKpiRejected', window.fn(totalRejected));
    window.setTxt('cxKpiAvgDone', window.fn(avgDone));

    var totalRequests = totalDone + totalWaiting + totalRejected;
    var compRate = totalRequests > 0 ? Math.round((totalDone / totalRequests) * 100) : 0;
    window.setTxt('cxKpiCompRate', compRate + '%');

    var dailyArr = Object.values(dailyStats).sort(function (a, b) {
      return a.date < b.date ? 1 : a.date > b.date ? -1 : 0;
    });
    window.cxDailyTrendData = dailyArr;
    window.renderCxDailyTrendTable();

    var catArr = Object.keys(categories)
      .map(function (k) {
        var st = categories[k];
        st.avgDone = st.datesWithDone && st.datesWithDone.size > 0 ? Math.round(st.done / st.datesWithDone.size) : st.done;
        return { name: k, stats: st };
      })
      .sort(function (a, b) {
        return b.stats.total - a.stats.total;
      });

    window.cxCategoriesData = catArr;
    if (typeof window.renderCxCategoryTable === 'function') {
      window.renderCxCategoryTable(10);
    }

    var tbodyRej = document.getElementById('cxRejectedTableBody');
    if (tbodyRej) {
      var htmlRej = '';
      rejectedList
        .slice()
        .reverse()
        .slice(0, 50)
        .forEach(function (rej) {
          htmlRej += '<tr style="border-bottom: 1px solid var(--border); transition: background 0.2s ease;">';
          htmlRej += '  <td style="padding: 10px 12px; font-weight: 700; font-size: 11px; color: var(--tp);">' + window.esc(rej.id) + '</td>';
          htmlRej += '  <td style="padding: 10px 12px; font-size: 11px; color: var(--ts);">' + window.esc(rej.cat) + '</td>';
          htmlRej += '  <td style="padding: 10px 12px; font-size: 11px; color: #b91c1c; max-width: 250px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="' + window.esc(rej.reason) + '">' + window.esc(rej.reason) + '</td>';
          htmlRej += '</tr>';
        });
      if (!htmlRej) {
        htmlRej = '<tr><td colspan="3" style="text-align: center; padding: 24px; color: var(--ts);">Tidak ada rejected hari ini. 🎉</td></tr>';
      }
      tbodyRej.innerHTML = htmlRej;
    }
  };

  window.renderCxDailyTrendTable = function () {
    var tbody = document.getElementById('cxDailyTrendTableBody');
    if (!tbody) return;

    var allTrend = window.cxDailyTrendData || [];
    var now = new Date();
    var yyyy = now.getFullYear();
    var mm = String(now.getMonth() + 1).padStart(2, '0');
    var dd = String(now.getDate()).padStart(2, '0');
    var todayStr = yyyy + '-' + mm + '-' + dd;
    var firstDayStr = yyyy + '-' + mm + '-01';

    var displayData = allTrend.filter(function (item) {
      return item.date >= firstDayStr && item.date <= todayStr;
    });

    // Fallback to latest available month if current calendar month has no records yet
    if (displayData.length === 0 && allTrend.length > 0) {
      var latestYm = allTrend[0].date.slice(0, 7);
      displayData = allTrend.filter(function (item) {
        return item.date.slice(0, 7) === latestYm;
      });
    }

    var tableData = displayData.slice().sort(function (a, b) {
      return a.date < b.date ? 1 : a.date > b.date ? -1 : 0;
    });

    var html = '';
    tableData.forEach(function (item) {
      var cRate = item.total > 0 ? Math.round((item.done / item.total) * 100) : 0;
      html += '<tr style="border-bottom: 1px solid var(--border); transition: background 0.2s ease;">';
      html += '  <td style="padding: 10px 12px; font-weight: 700; font-size: 11px; color: var(--tp);">' + window.esc(item.date) + '</td>';
      html += '  <td style="padding: 10px 12px; text-align: center; font-family: var(--font-mono); font-weight: 900; color: #1d4ed8; background: rgba(37, 99, 235, 0.08);">' + window.fn(item.total) + '</td>';
      html += '  <td style="padding: 10px 12px; text-align: center; font-family: var(--font-mono); font-weight: 800; color: #047857;">' + window.fn(item.done) + '</td>';
      html += '  <td style="padding: 10px 12px; text-align: center; font-family: var(--font-mono); font-weight: 800; color: #b45309;">' + window.fn(item.waiting) + '</td>';
      html += '  <td style="padding: 10px 12px; text-align: center; font-family: var(--font-mono); font-weight: 800; color: #b91c1c;">' + window.fn(item.rejected) + '</td>';
      html += '  <td style="padding: 10px 12px; text-align: center; font-family: var(--font-mono); font-weight: 900; color: #7e22ce; background: rgba(168, 85, 247, 0.08);">' + cRate + '%</td>';
      html += '</tr>';
    });

    if (!html) {
      html = '<tr><td colspan="6" style="text-align: center; padding: 24px; color: var(--ts);">Tidak ada data trend harian di periode ini.</td></tr>';
    }
    tbody.innerHTML = html;

    var chartData = displayData.slice().sort(function (a, b) {
      return a.date > b.date ? 1 : a.date < b.date ? -1 : 0;
    });
    if (typeof window.renderCxDailyTrendChart === 'function') {
      window.renderCxDailyTrendChart(chartData);
    }
  };
})();
