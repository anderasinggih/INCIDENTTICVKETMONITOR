U.ready(function () {
    // 1. Dapatkan Order ID tiket aktif
    function getTicketId() {
        // Cek URL params (orderid=INC-xxxx / ticketid=...)
        var candidates = [window.location.href, window.location.search];
        try { if (window.parent) candidates.push(window.parent.location.href, window.parent.location.search); } catch (e) { }
        try { if (window.top) candidates.push(window.top.location.href, window.top.location.search); } catch (e) { }

        for (var j = 0; j < candidates.length; j++) {
            var str = candidates[j] || '';
            var m = str.match(/orderid=([^&]+)/i);
            if (m && m[1]) return decodeURIComponent(m[1]).trim();
        }

        // Cek komponen form S('orderid') / S('order_id')
        try {
            if (typeof S === 'function') {
                var compNames = ['orderid', 'order_id', 'ticketid', 'ticket_id'];
                for (var i = 0; i < compNames.length; i++) {
                    var c = S(compNames[i]);
                    if (c && c.getValue && String(c.getValue()).indexOf('INC-') !== -1) {
                        return String(c.getValue()).trim();
                    }
                }
            }
        } catch (e) { }

        // Fallback teks di body
        try {
            var text = document.body ? document.body.innerText : '';
            var matchText = text.match(/INC-\d{8}-\d+/);
            if (matchText) return matchText[0];
        } catch (e) { }

        return '';
    }

    var orderId = getTicketId();
    console.log('[TT_PAGE] Found Order ID:', orderId);

    if (!orderId) {
        setTimeout(function () {
            var retryId = getTicketId();
            if (retryId) loadEscalationLogService(retryId);
        }, 1200);
        return;
    }

    loadEscalationLogService(orderId);

    // 2. Panggil service incwo_get_escalation_log_text
    function loadEscalationLogService(targetOrderId) {
        MessageProcessor.process({
            serviceId: "/adc-service/rest/v1/services/CN_GSC_ID_Surge_Noc_Dashboard/IncidentTicketMonitor/incwo_get_escalation_log_text",
            data: {
                orderid: targetOrderId
            },
            success: function (res) {
                var textVal = (res && res.escalation_recordtext) ? res.escalation_recordtext : "-";

                // 3. Masukkan hasil teks ke komponen form 'escalation_recordtext'
                var retries = 0;
                var timer = setInterval(function () {
                    retries++;
                    try {
                        if (typeof S === 'function' && S('escalation_recordtext')) {
                            var comp = S('escalation_recordtext');
                            comp.setValue(textVal);

                            if (typeof Spl !== 'undefined' && Spl.EventBus && Spl.EventBus.dispatch) {
                                Spl.EventBus.dispatch('escalation_recordtext', 'ValueChange', { value: textVal });
                            }

                            if (comp.getValue() === textVal || retries > 3) {
                                clearInterval(timer);
                                console.log('[TT_PAGE] Successfully populated escalation_recordtext!');
                            }
                        }
                    } catch (e) { }

                    if (retries >= 15) clearInterval(timer);
                }, 400);
            },
            error: function (err) {
                console.error('[TT_PAGE] Failed to call incwo_get_escalation_log_text:', err);
                try {
                    if (typeof S === 'function' && S('escalation_recordtext')) {
                        S('escalation_recordtext').setValue("-");
                    }
                } catch (e) { }
            }
        });
    }
});

