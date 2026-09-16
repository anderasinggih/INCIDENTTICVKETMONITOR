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

    var existingResults = (response && response.results) ? response.results : [];
    let orderIds = existingResults.map((item) => item.orderid);
    if (orderIds.includes(orderid)) {
        return {
            code: 500,
            error: false,
            message: "orderid: " + orderid + " already exists in the list",
        };
    }

    // 2. Query data tiket utama (READ-ONLY)
    let isPMA = orderid && orderid.startsWith("PMA-");
    let ttInfo = isPMA ? getPMAInfo(orderid) : getTTInfo(orderid);

    if (COMMON_UTIL.isNull(ttInfo)) {
        return {
            code: 500,
            error: false,
            message:
                "Ticket not found or ticket status is not running. Kindly review ticket " + orderid,
        };
    }

    let finalDomain = "FWA";
    let cm_orderid = "";
    let createTime = TimeUtil.getUTCString();

    if (isPMA) {
        finalDomain = "PMA";
        cm_orderid = ttInfo.problem_ticket_id || "";
    } else {
        // Normalisasi domain: tiket yang mengandung kata FTTH masuk ke FTTH, selain itu otomatis FWA (FWA-RAN, FWA Core, RAN, dll.)
        let ticketDomain = COMMON_UTIL.isNull(ttInfo.domain) ? (COMMON_UTIL.isNull(ttInfo.raw_domain) ? "" : String(ttInfo.raw_domain).trim()) : String(ttInfo.domain).trim();
        let determinedDomain = ticketDomain.toUpperCase().indexOf("FTTH") !== -1 ? "FTTH" : "FWA";
        finalDomain = !COMMON_UTIL.isNull(determinedDomain) ? determinedDomain : domain;

        let associateorderid = ttInfo.associateorderid;
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
    }

    // 3. Simpan snapshot tiket ke Data Model lokal
    let list = [];
    if (!COMMON_UTIL.isNull(ttInfo)) {
        var requestInfo = {
            orderid: isPMA ? ttInfo.order_id : ttInfo.orderid,
            title: ttInfo.title || "",
            cm_orderid: cm_orderid,
            start_time: isPMA ? ttInfo.plan_start_time : ttInfo.createtime,
            impact_mpls: "",
            pic: isPMA ? (ttInfo.pt_responsibility_party || "") : "",
            alarm_time: isPMA ? ttInfo.plan_start_time : ttInfo.alarm_time,
            clear_time: isPMA ? ttInfo.plan_end_time : ttInfo.clear_time,
            root_cause: ttInfo.root_cause || "",
            sub_root_cause: ttInfo.sub_root_cause || "",
            inter_station: isPMA ? (ttInfo.link_segment_detail || "") : "",
            rca_description: isPMA ? (ttInfo.resolution_notes || "") : ttInfo.initial_rca,
            estimated_cp: isPMA ? "" : ttInfo.estimated_cp,
            tt_domain: finalDomain,
            ticket_status: isPMA ? ttInfo.order_status : ttInfo.ticket_status,
            active: true,
            tt_action: isPMA ? (ttInfo.resolution_notes || "") : ttInfo.tt_action,
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

function getPMAInfo(orderid) {
    let cleanOrderId = String(orderid).trim();
    let tql = `select order_id, order_status, title, problem_ticket_id, pt_responsibility_party,
            plan_start_time, plan_end_time, root_cause, sub_root_cause, link_segment_detail, resolution_notes
            from "/ProblemManagementActivity/ProblemManagementActivity/pma_problemmanagementactivity"
            where (order_id = $orderid or order_id like '%${cleanOrderId}%')
            and (order_status like '%running%' or order_status like '%Running%')
            order by order_id desc
           `;
    let request = {
        start: 0,
        limit: 1,
        tql: tql,
        parameters: {
            orderid: cleanOrderId,
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
        console.error(PREFIX + " getPMAInfo failed: " + e);
    }
    return null;
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
