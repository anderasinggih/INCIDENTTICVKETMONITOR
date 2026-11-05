const PREFIX = `[/${_context.project}/${_context.module}/${_context.serviceName}] `;
const COMMON_UTIL =
    require("/CN_GSC_ID_Surge_Noc_Dashboard/netdrone_maps/commonUtil").commonUtil;

try {
    return main();
} catch (e) {
    console.error(PREFIX + "Error: " + e);
    return { code: 500, message: e.message || String(e), escalation_recordtext: "-", log_text: "-" };
}

function main() {
    // 1. Ekstrak orderid dari konteks pesan / parameter eksekusi (support berbagai struktur SPL flow)
    let orderId = "";
    if (typeof _message !== "undefined" && _message) {
        orderId = _message.orderid || 
                  _message.order_id || 
                  _message.ticket_id || 
                  _message.ticketid || 
                  (_message.request && (_message.request.orderid || _message.request.order_id)) ||
                  (_message.data && (_message.data.orderid || _message.data.order_id)) ||
                  (_message.result && (_message.result.orderid || _message.result.order_id)) ||
                  (_message.tt_troubleticket && (_message.tt_troubleticket.orderid || _message.tt_troubleticket.order_id)) ||
                  "";
    }

    if (COMMON_UTIL.isNull(orderId)) {
        return { 
            code: 400, 
            message: "orderid is required", 
            escalation_recordtext: "-", 
            log_text: "-" 
        };
    }

    // 2. Query ke data model incwo_escalation_log via TQL (filter pasti sesuai orderid)
    let tql = `select id, orderid, log_type, esc_level, support_status, description, operator_id, operator_name, create_time ` +
        `from "/CN_GSC_ID_Surge_Noc_Dashboard/IncidentTicketMonitor/incwo_escalation_log" ` +
        `where orderid = $orderid ` +
        `order by create_time asc`;

    let request = {
        start: 0,
        limit: 100,
        tql: tql,
        parameters: { orderid: String(orderId).trim() },
        contains_total: false
    };

    let response = ServiceInvoker.post(
        "/adc-model/rest/v2/model-instances/query-by-tql",
        request
    );

    let logs = (response && response.results) ? response.results : [];
    if (!Array.isArray(logs) || logs.length === 0) {
        return { 
            code: 200, 
            message: "No escalation logs found", 
            orderid: orderId, 
            log_text: "-", 
            escalation_recordtext: "-", 
            logs: [],
            data: {
                escalation_recordtext: "-",
                logs: []
            }
        };
    }

    // 3. Format setiap riwayat baris log menjadi teks bebas terstruktur
    let lines = [];
    logs.forEach(function (item) {
        let timeStr = item.create_time || "";
        // Format waktu menjadi "HH:mm YYYY-MM-DD"
        let displayTime = timeStr;
        if (timeStr && timeStr.indexOf(" ") !== -1) {
            let parts = timeStr.split(" ");
            let datePart = parts[0] || "";
            let timePart = parts[1] ? parts[1].substring(0, 5) : "";
            displayTime = timePart + " " + datePart;
        }

        // Tentukan teks aksi (Level vs Support)
        let actionText = "";
        let lType = String(item.log_type || item.type || "").toUpperCase();
        let isSupp = (lType === "NEED_SUPPORT" || lType === "SUPPORT");
        if (isSupp) {
            let st = String(item.support_status || item.status || "NEED").toUpperCase();
            actionText = (st === "NEED" || st === "NEED SUPPORT") ? "Set to Need Support" : "Set to No Need Support";
        } else {
            let lvl = item.esc_level !== undefined && item.esc_level !== null ? item.esc_level : (item.level || "0");
            actionText = "Set to Level " + lvl;
        }

        let desc = item.description || item.note || "-";
        let opId = item.operator_id || "";
        let opName = item.operator_name || "";
        let opFull = (opId + " " + opName).trim();
        if (!opFull) opFull = "Operator";

        // Format: 11:26 2026-10-05 | Set to Level 1 | description (Operator aWX1537748 ANDERA SINGGIH)
        lines.push(displayTime + " | " + actionText + " | " + desc + " (Operator " + opFull + ")");
    });

    let fullLogText = lines.join("\n");

    return {
        code: 200,
        message: "Success",
        orderid: orderId,
        log_text: fullLogText,
        escalation_recordtext: fullLogText,
        logs: logs,
        data: {
            escalation_recordtext: fullLogText,
            logs: logs
        }
    };
}
