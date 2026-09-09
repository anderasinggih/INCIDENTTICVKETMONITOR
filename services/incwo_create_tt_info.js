const PREFIX = `[/${_context.project}/${_context.module}/${_context.serviceName}] `;
const COMMON_UTIL =
    require("/CN_GSC_ID_Surge_Noc_Dashboard/netdrone_maps/commonUtil").commonUtil;

try {
    return main();
} catch (e) {
    console.error(PREFIX + "internal error" + e);
    return { code: 500, error: true, message: "Internal Error: " + (e.message || e) };
}

function main() {
    // 1. Query apakah sudah mencapai limit 6 tiket atau sudah ada orderid tsb
    let orderid = _message.orderid;
    let domain = _message.domain;
    domain = domain == "FTTH" ? domain : "FWA";

    var request = {};
    var response = ServiceInvoker.post(
        "/adc-service/rest/v1/services/CN_GSC_ID_Surge_Noc_Dashboard/IncidentTicketMonitor/incwo_incidentticketmonitor_get_list",
        request
    );

    let total = (response && response.total !== undefined) ? response.total : ((response && response.results) ? response.results.length : 0);
    if (total >= 8) {
        return {
            code: 500,
            error: false,
            message:
                "The number of work orders has already reached 8. Please delete and then add.",
        };
    }

    let existingResults = (response && response.results) ? response.results : [];
    let orderIds = existingResults.map((item) => item.orderid);
    if (orderIds.includes(orderid)) {
        return {
            code: 500,
            error: false,
            message: "orderid: " + orderid + " already exists in the list",
        };
    }

    // 2. Query data tiket utama (READ-ONLY)
    let ttInfo = getTTInfo(orderid);

    if (COMMON_UTIL.isNull(ttInfo)) {
        return {
            code: 500,
            error: false,
            message:
                "Ticket not found or ticket status is not running. Kindly review ticket " + orderid,
        };
    }

    // Normalisasi domain: tiket yang mengandung kata FTTH masuk ke FTTH, selain itu otomatis FWA (FWA-RAN, FWA Core, RAN, dll.)
    let ticketDomain = COMMON_UTIL.isNull(ttInfo.domain) ? (COMMON_UTIL.isNull(ttInfo.raw_domain) ? "" : String(ttInfo.raw_domain).trim()) : String(ttInfo.domain).trim();
    let determinedDomain = ticketDomain.toUpperCase().indexOf("FTTH") !== -1 ? "FTTH" : "FWA";
    
    // Gunakan domain yang terdeteksi dari tiket, atau fallback ke domain input
    let finalDomain = !COMMON_UTIL.isNull(determinedDomain) ? determinedDomain : domain;

    let associateorderid = ttInfo.associateorderid;
    let cm_orderid = "";
    let createTime = TimeUtil.getUTCString();

    if (!COMMON_UTIL.isNull(associateorderid)) {
        let orderIdArr = associateorderid.split(";");
        let cmIdArr = [];
        for (let i = 0; i < orderIdArr.length; i++) {
            if (orderIdArr[i].indexOf("CM") != -1) {
                cmIdArr.push(orderIdArr[i]);
            }
        }
        if (!COMMON_UTIL.isNull(cmIdArr)) {
            cm_orderid = cmIdArr.join(";");
        }
    }

    // 3. Simpan snapshot tiket ke Data Model lokal
    let list = [];
    if (!COMMON_UTIL.isNull(ttInfo)) {
        var requestInfo = {
            orderid: ttInfo.orderid,
            title: ttInfo.title,
            cm_orderid: cm_orderid,
            start_time: ttInfo.createtime,
            impact_mpls: "",
            pic: "",
            alarm_time: ttInfo.alarm_time,
            clear_time: ttInfo.clear_time,
            root_cause: ttInfo.root_cause,
            sub_root_cause: ttInfo.sub_root_cause,
            inter_station: "",
            rca_description: ttInfo.initial_rca,
            estimated_cp: ttInfo.estimated_cp,
            tt_domain: finalDomain,
            ticket_status: ttInfo.ticket_status,
            active: true,
            tt_action: ttInfo.tt_action,
            create_time: createTime,
        };
        list.push(requestInfo);

        let upsertRequest = {
            _values: list,
        };

        var upsertResponse = ServiceInvoker.post(
            "/adc-service/rest/v1/services/CN_GSC_ID_Surge_Noc_Dashboard/IncidentTicketMonitor/incwo_incidentticketmonitor_batch_upsert",
            upsertRequest
        );
    }

    return { code: 200, response: upsertResponse };
}

function getTTInfo(orderid) {
    let tql = `select orderid,tickettype,ticketstatus as ticket_status,title, associateorderid,createtime,createfaultfirstoccurtime as alarm_time,
            faultresolvingtime as clear_time,root_cause,sub_root_cause,link_segment,initial_rca,estimated_cp,incident_chronology as tt_action,
            tt.domain as raw_domain, d.name as domain
            from "/TroubleTicket/TroubleTicket/tt_troubleticket" as tt
            left join "/datahub/cmdb/cmdb_domain" d on d.id=tt.domain 
            where orderid = $orderid and ticketstatus ='running'
            order by orderid desc
           `;
    let request = {
        start: 0,
        limit: 1000,
        tql: tql,
        parameters: {
            orderid: orderid,
        },
        contains_total: false,
    };
    try {
        var response = ServiceInvoker.post(
            "/adc-model/rest/v2/model-instances/query-by-tql",
            request
        );
        if (!COMMON_UTIL.isNull(response.results) && response.results.length > 0) {
            return response.results[0];
        }
    } catch (e) {
        console.error(PREFIX + " getTTInfo failed: " + e);
    }
    return null;
}
