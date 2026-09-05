const PREFIX = `[/${_context.project}/${_context.module}/${_context.serviceName}] `;
const COMMON_UTIL =
    require("/CN_GSC_ID_Surge_Noc_Dashboard/netdrone_maps/commonUtil").commonUtil;

try {
    return main();
} catch (e) {
    console.error(PREFIX + "internal error" + e);
}
function main() {
    //1.查询link down tt 单号

    if (!COMMON_UTIL.isNull(domain) && domain == "DWDM") {
        domainCondition = ` and ems.ems_name ='DWDM_Huawei_NCE_T'  and tt.domain ='DWDM'`;
    } else if (!COMMON_UTIL.isNull(domain) && domain == "MPLS") {
        domainCondition = ` and ems.ems_name ='MPLS_Huawei_NC_IP'  and tt.domain !='DWDM'`;
        //拼接多个条件：device_name LIKE '%AGG%' or device_name LIKE '%ACC%'
        domainCondition = device_con(domainCondition);
    } else {
        domainCondition = `and ems.ems_name in ('MPLS_Huawei_NC_IP','DWDM_Huawei_NCE_T') `;
    }

    let ttInfo = getLinkDownTT(domainCondition);
    return ttInfo;
}

function getLinkDownTT(domainCondition) {
    try {
        let tql = `select orderid,tickettype,ticketstatus,title, associateorderid,createtime,ems_name,createfaultfirstoccurtime as alarm_time,
            faultresolvingtime as clear_time,root_cause,estimated_cp
            from "/TroubleTicket/TroubleTicket/tt_troubleticket" as tt
            left join "/datahub/cmdb/cmdb_ems" as ems on tt.ems=ems.id  
            where  1 and 1 
            ${domainCondition} 
            order by orderid desc
           `;
        let request = {
            start: 0,
            limit: 1000,
            tql: tql,
            parameters: {
                domainCondition: domainCondition,
            },
            contains_total: false,
        };

        var response = ServiceInvoker.post(
            "/adc-model/rest/v2/model-instances/query-by-tql",
            request
        );
        if (!COMMON_UTIL.isNull(response.results)) {
            return response.results;
        }
    } catch (e) {
        console.error(PREFIX + " getTTEmsAlarmNo failed. " + e);
    }
    return [];
}
