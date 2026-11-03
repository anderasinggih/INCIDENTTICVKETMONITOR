/**
 * Universal Auto-add to Incident & Link Down Ticket Monitor on Submit
 * Taruh di: Page Execute Script pada Form TT9 (Handle TT)
 * File: tt9 script/add_ticket_monitor_on_submit.js
 * 
 * Logika:
 * - Jika tiket berdomain FTTH / FWA -> Otomatis masuk ke Incident Ticket Monitor
 * - Jika tiket berdomain MPLS / DWDM -> Otomatis masuk ke Link Down Ticket Monitor
 * - Masing-masing service di backend otomatis skip aman (return 200 skipped) jika domain tidak cocok
 */
U.ready(function () {
    // 1. Ambil Order ID resmi tiket
    var orderId = '';
    if (typeof S === 'function' && S('orderid') && S('orderid').getValue) {
        orderId = S('orderid').getValue();
    }
    if (!orderId && window.location.search) {
        var m = window.location.search.match(/[?&]order_?id=([^&#]+)/i);
        if (m) orderId = decodeURIComponent(m[1]).trim();
    }
    if (!orderId) {
        var mInc = (window.location.href + ' ' + (document.body ? document.body.innerText : '')).match(/INC-\d{8}-\d+/);
        if (mInc) orderId = mInc[0].trim();
    }

    if (!orderId) {
        console.warn('[AutoAddMonitor] Order ID not found');
        return;
    }

    console.log('[AutoAddMonitor] Ready for Ticket:', orderId);

    var hasRun = false;

    function doAutoAdd() {
        if (hasRun) return;
        hasRun = true;

        console.log('[AutoAddMonitor] Mendaftarkan orderid ke monitor:', orderId);

        if (typeof MessageProcessor !== 'undefined' && MessageProcessor.process) {
            // 1. Kirim ke Incident Ticket Monitor (FTTH / FWA)
            try {
                MessageProcessor.process({
                    serviceId: '/adc-service/rest/v1/services/CN_GSC_ID_Surge_Noc_Dashboard/IncidentTicketMonitor/incwo_create_tt_info',
                    data: { orderid: orderId },
                    success: function (res) {
                        console.log('[AutoAddMonitor] Respon Incident Ticket Monitor:', res);
                    },
                    error: function (err) {
                        console.warn('[AutoAddMonitor] Incident Monitor notice:', err);
                    }
                });
            } catch (e1) {
                console.warn('[AutoAddMonitor] Invoking incwo_create_tt_info error:', e1);
            }

            // 2. Kirim ke Link Down Ticket Monitor (MPLS / DWDM)
            try {
                MessageProcessor.process({
                    serviceId: '/adc-service/rest/v1/services/CN_GSC_ID_Surge_Noc_Dashboard/LinkDownTicketMonitor/inclink_create_tt_info',
                    data: { orderid: orderId },
                    success: function (res) {
                        console.log('[AutoAddMonitor] Respon Link Down Ticket Monitor:', res);
                    },
                    error: function (err) {
                        console.warn('[AutoAddMonitor] Link Down Monitor notice:', err);
                    }
                });
            } catch (e2) {
                console.warn('[AutoAddMonitor] Invoking inclink_create_tt_info error:', e2);
            }
        }
    }

    // 2. Pasang hook ke tombol Submit / Process
    setTimeout(function () {
        // Coba via SDK OWS component
        try {
            if (typeof S === 'function' && S('Submit') && typeof S('Submit').on === 'function') {
                S('Submit').on('click', doAutoAdd);
            }
        } catch (eBtn) { }

        // Fallback ke semua elemen tombol Submit / Process di DOM
        try {
            var buttons = document.querySelectorAll('button, #Submit, [id*="Submit"], .el-button');
            buttons.forEach(function (btn) {
                var text = (btn.innerText || btn.textContent || '').trim();
                if (btn.id === 'Submit' || text === 'Submit' || text === 'Process') {
                    btn.addEventListener('click', doAutoAdd, false);
                }
            });
        } catch (eDom) { }
    }, 600);
});
