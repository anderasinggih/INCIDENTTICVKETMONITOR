/**
 * OWS Flow Execute Script: Load Escalation Level & Support Status into Trouble Ticket Flow Form
 * Target File: /Volumes/LVNPC/HUAWEI/PROJECT/Incident Ticket Monitor/tt11 script/load_escalation_in_flow.js
 * 
 * Fungsi:
 * 1. Mendapatkan orderid Trouble Ticket (dari S('orderid') atau URL context)
 * 2. Mengambil field escalationlevelnumber & escalationsupport dari tt_troubleticket via tt_troubleticket_get
 * 3. Menampilkan nilai ke komponen form:
 *    - Komponen ID: 'showescalationlevel' -> Level 1..5 atau "No Escalation"
 *    - Komponen ID: 'showescalationsupport' -> "Need Support" atau "No Need Support"
 */

U.ready(function () {
    var LEVEL_COMP_ID = 'showescalationlevel';
    var SUPPORT_COMP_ID = 'showescalationsupport';

    function getTicketOrderId() {
        // 1. Coba ambil dari komponen form bawaan OWS
        try {
            if (typeof S === 'function') {
                var compCandidates = ['orderid', 'order_id', 'ticketid', 'ticket_id'];
                for (var i = 0; i < compCandidates.length; i++) {
                    var comp = S(compCandidates[i]);
                    if (comp && comp.getValue) {
                        var val = comp.getValue();
                        if (val && typeof val === 'string' && val.trim().length > 0) {
                            return val.trim();
                        } else if (Array.isArray(val) && val.length > 0) {
                            var itemVal = (val[0].orderid || val[0].id || val[0].value || val[0] || '').toString().trim();
                            if (itemVal) return itemVal;
                        } else if (val && typeof val === 'object') {
                            var objVal = (val.orderid || val.id || val.value || '').toString().trim();
                            if (objVal) return objVal;
                        }
                    }
                }
            }
        } catch (eComp) { }

        // 2. Coba parse dari URL window / parent / top
        var urlCandidates = [window.location.href, window.location.search];
        try { if (window.parent) urlCandidates.push(window.parent.location.href, window.parent.location.search); } catch (eP) { }
        try { if (window.top) urlCandidates.push(window.top.location.href, window.top.location.search); } catch (eT) { }

        for (var j = 0; j < urlCandidates.length; j++) {
            var urlStr = urlCandidates[j] || '';
            var m = urlStr.match(/[?&]order_?id=([^&#]+)/i);
            if (m && m[1]) {
                return decodeURIComponent(m[1]).trim();
            }
            // Match pattern INC-YYYYMMDD-XXXX
            var mInc = urlStr.match(/INC-\d{8}-\d+/i);
            if (mInc) {
                return mInc[0].trim();
            }
        }

        // 3. Coba cari di teks body/header jika ada pattern orderid
        try {
            var bodyText = document.body ? document.body.innerText : '';
            var matchInc = bodyText.match(/INC-\d{8}-\d+/);
            if (matchInc) {
                return matchInc[0].trim();
            }
        } catch (eDom) { }

        return '';
    }

    function setComponentValue(compId, displayVal, rawVal) {
        // Coba set via SDK OWS S(compId)
        var setSuccess = false;
        try {
            if (typeof S === 'function' && S(compId)) {
                var comp = S(compId);
                if (typeof comp.setValue === 'function') {
                    comp.setValue(displayVal);
                    setSuccess = true;
                } else if (typeof comp.setText === 'function') {
                    comp.setText(displayVal);
                    setSuccess = true;
                }
            }
        } catch (eS) { }

        // Fallback DOM jika komponen berwujud label / static text / input standar
        try {
            var elem = document.getElementById(compId);
            if (elem) {
                if (elem.tagName === 'INPUT' || elem.tagName === 'TEXTAREA' || elem.tagName === 'SELECT') {
                    elem.value = displayVal;
                    // Trigger change event agar framework mendeteksi
                    var evt = document.createEvent('HTMLEvents');
                    evt.initEvent('change', true, false);
                    elem.dispatchEvent(evt);
                } else {
                    elem.innerText = displayVal;
                }
                setSuccess = true;
            } else if (window.$ && $('#' + compId).length) {
                var $el = $('#' + compId);
                if ($el.is('input, textarea, select')) {
                    $el.val(displayVal).trigger('change');
                } else {
                    $el.text(displayVal);
                }
                setSuccess = true;
            }
        } catch (eDom) { }

        return setSuccess;
    }

    function loadEscalationData() {
        var orderId = getTicketOrderId();
        if (!orderId) {
            return;
        }

        var serviceUrl = "/adc-service/rest/v1/services/TroubleTicket/TroubleTicket/tt_troubleticket_get";
        var payload = {
            "orderid": orderId
        };

        MessageProcessor.process({
            serviceId: serviceUrl,
            data: payload,
            success: function (res) {
                if (res && res.result) {
                    var data = res.result;

                    // 1. Format Escalation Level
                    var rawLevel = data.escalationlevelnumber;
                    var levelNum = Number(rawLevel);
                    var levelDisplay = '-';
                    if (!isNaN(levelNum) && levelNum > 0) {
                        levelDisplay = 'Level ' + levelNum;
                    } else if (rawLevel !== undefined && rawLevel !== null && String(rawLevel).trim() !== '') {
                        levelDisplay = String(rawLevel).trim();
                    } else {
                        levelDisplay = 'No Escalation';
                    }

                    // 2. Format Escalation Support
                    var rawSupport = (data.escalationsupport || '').toString().trim().toUpperCase();
                    var supportDisplay = '-';
                    if (rawSupport === 'NEED' || rawSupport === 'NEED SUPPORT') {
                        supportDisplay = 'Need Support';
                    } else if (rawSupport === 'NO_NEED' || rawSupport === 'NO NEED' || rawSupport === 'NO NEED SUPPORT') {
                        supportDisplay = 'No Need Support';
                    } else if (rawSupport) {
                        supportDisplay = rawSupport;
                    } else {
                        supportDisplay = 'No Need Support';
                    }

                    // Set ke masing-masing komponen
                    setComponentValue(LEVEL_COMP_ID, levelDisplay, rawLevel);
                    setComponentValue(SUPPORT_COMP_ID, supportDisplay, rawSupport);
                }
            },
            error: function (err) {
                console.error("[load_escalation_in_flow] Error fetching troubleticket:", err);
            }
        });
    }

    // Jalankan segera saat ready, dan gunakan jeda bertahap (karena form OWS me-render komponen secara async)
    loadEscalationData();
    setTimeout(loadEscalationData, 500);
    setTimeout(loadEscalationData, 1200);
    setTimeout(loadEscalationData, 2500);

    // Daftarkan listener jika orderid diubah oleh user/event bus
    if (typeof Spl !== 'undefined' && Spl.EventBus && Spl.EventBus.register) {
        Spl.EventBus.register('orderid', 'value-change', function () {
            setTimeout(loadEscalationData, 200);
        });
    }
});
