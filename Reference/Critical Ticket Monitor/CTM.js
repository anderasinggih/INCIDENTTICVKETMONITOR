const $W = window;
U.ready(function () {
    var container = document.getElementById('htmlPanela9d62c48');
    if (!container) { console.error('Container htmlPanela9d62c48 not found'); return; }
    if (typeof window.Vue === 'undefined') { console.error('Vue not found on window'); return; }

    var app = window.Vue.createApp({
        template: '<div class="custom-wrapper">' +
            '<div class="custom-header">' +
            '<div class="custom-header-actions">' +
            '<div class="custom-card-domain-dwdw-field"><span class="custom-field-domain-label">DWDM :</span><span class="custom-field-domain-value">{{ dwdmNum || \'-\' }}</span></div>' +
            '<div class="custom-card-domain-mpls-field"><span class="custom-field-domain-label">MPLS :</span><span class="custom-field-domain-value">{{ mplsNum || \'-\' }}</span></div>' +
            '</div>' +
            '<div class="custom-header-actions">' +
            '<button class="custom-btn custom-btn-add" id="addBtn" @click="openAddModal" :disabled="tickets.length >= maxTickets">Add</button>' +
            '</div>' +
            '</div>' +
            '<div class="custom-grid-container" id="ticketGrid">' +
            '<div v-if="loading" class="custom-loading">Loading...</div>' +
            '<div v-else-if="filteredTickets.length === 0" class="custom-empty-state">' +
            '<p>No Ticket. Please Click Add to Create.</p>' +
            '</div>' +
            '<div v-for="ticket in filteredTickets" :key="ticket.id" class="custom-ticket-card" :class="ticket.ticket_status === \'running\' ? \'pending\' : \'completed\'">' +
            '<div class="custom-card-header">' +
            '<span class="custom-ticket-id">' +
            '{{ ticket.id }}' +
            '<span :class = "ticket.tt_domain === \'MPLS\' ? \'custom-domain-mpls-badge \' : \'custom-domain-dwdm-badge\'"  >' +
            '{{ ticket.tt_domain }}' +
            '</span>' +
            '</span>' +

            '<span class="custom-ticket-status" :class="ticket.ticket_status === \'running\' ? \'status-processing\' : \'status-completed\'">{{ ticket.ticket_status }}</span>' +
            '</div>' +
            '<div class="custom-card-content">' +
            '<div class="custom-card-field"><span class="custom-field-label">Title</span><span class="custom-field-tilte-value">{{ ticket.title || \'-\' }}</span></div>' +
            '<div class="custom-card-field"><span class="custom-field-label">CM</span><span class="custom-field-value">{{ ticket.cm_orderid || \'-\' }}</span></div>' +
            '<div class="custom-card-field"><span class="custom-field-label">InterStation</span><span class="custom-field-value">{{ ticket.inter_station || \'-\' }}</span></div>' +
            '<div class="custom-card-field"><span class="custom-field-label">Alarm Time</span><span class="custom-field-value">{{ ticket.alarm_time || \'-\' }}</span></div>' +
            '<div class="custom-card-field"><span class="custom-field-label">Clear Time</span><span class="custom-field-value">{{ ticket.clear_time || \'-\' }}</span></div>' +
            '<div class="custom-card-field"><span class="custom-field-label">Aging Time</span><span class="custom-field-value">{{ ticket.aging_time || \'-\' }}</span></div>' +
            '<div class="custom-card-field"><span class="custom-field-label">RCA Description</span><span class="custom-field-value">{{ ticket.rca_description || \'-\' }}</span></div>' +
            '<div class="custom-card-field"><span class="custom-field-label">PIC</span><span class="custom-field-value">{{ ticket.pic || \'-\' }}</span></div>' +
            '<div class="custom-card-field"><span class="custom-field-label">Status</span><span class="custom-field-value">{{ ticket.alarm_status || \'-\' }}</span></div>' +

            '</div>' +
            '<div class="custom-card-action">' +
            '<div class="custom-action-label">{{ ticket.tt_domain === "DWDM" ? "DWDM" : "MPLS" }} Impact</div>' +
            '<div class="custom-impart-action-content">{{ ticket.impact_mpls || \'-\' }}</div>' +
            '</div>' +
            '<div class="custom-card-action">' +
            '<div class="custom-action-label">Action</div>' +
            '<div class="custom-tt-action-content">{{ ticket.tt_action || \'-\' }}</div>' +
            '</div>' +
            '<div class="custom-card-actions">' +
            '<button class="custom-btn-card custom-btn-details" @click="handleDetails(ticket.id)">Details</button>' +
            '<button class="custom-btn-card custom-btn-del" @click="handleDel(ticket.id)">DEL</button>' +
            '</div>' +
            '</div>' +
            '</div>' +
            '<div class="custom-modal" :class="{ show: showAddModal }" id="addModal" @click="closeAddModalOnBackdrop">' +
            '<div class="custom-modal-content">' +
            '<div class="custom-modal-header">' +
            '<h2>Add Work Order</h2>' +
            '<button class="custom-modal-close" @click="closeAddModal">&times;</button>' +
            '</div>' +
            '<form @submit.prevent="submitTicket">' +
            '<div class="custom-modal-field">' +
            '<label class="custom-modal-label">Domain</label>' +
            '<select class="custom-form-select" v-model="addForm.domain" required>' +
            '<option value="MPLS">MPLS</option>' +
            '<option value="DWDM">DWDM</option>' +
            '</select>' +
            '</div>' +
            '<div class="custom-modal-field">' +
            '<label class="custom-modal-label">TT</label>' +
            '<input type="text" class="custom-form-input" v-model="addForm.ticketId" placeholder="Enter TT number" required>' +
            '</div>' +

            '<div class="custom-modal-actions">' +
            '<button type="button" class="custom-btn-cancel" @click="closeAddModal">Cancel</button>' +
            '<button type="submit" class="custom-btn-submit">Confirm</button>' +
            '</div>' +
            '</form>' +
            '</div>' +
            '</div>' +
            '<div class="custom-modal" :class="{ show: showDetailModal }" id="detailModal" @click="closeDetailModalOnBackdrop">' +
            '<div class="custom-modal-content">' +
            '<div class="custom-modal-header">' +
            '<h2>Work Order Detail</h2>' +
            '<button class="custom-modal-close" @click="closeModal">&times;</button>' +
            '</div>' +
            '<div class="custom-modal-body">' +
            '<div class="custom-modal-field"><label class="custom-modal-label">Root Cause</label><input type="text" class="custom-form-input" v-model="detailForm.root_cause"></div>' +
            '<div class="custom-modal-field"><label class="custom-modal-label">Sub Root Cause</label><input type="text" class="custom-form-input" v-model="detailForm.sub_root_cause"></div>' +
            '<div class="custom-modal-field"><label class="custom-modal-label">RCA Description</label><input type="text" class="custom-form-input" v-model="detailForm.rca_description"></div>' +
            '<div class="custom-modal-field"><label class="custom-modal-label">Predictive ETR</label><input type="text" class="custom-form-input" v-model="detailForm.predictive_etr"></div>' +
            '<div class="custom-modal-field"><label class="custom-modal-label">Fiber Doctor/OTDR</label><input type="text" class="custom-form-input" v-model="detailForm.estimated_cp"></div>' +

            '<div class="custom-modal-field">' +
            '<label class="custom-modal-label">PIC</label>' +
            '<select class="custom-form-select" v-model="detailForm.pic">' +
            '<option value="">Please Select</option>' +
            '<option v-for="item in detailForm.picList" :key="item.contractor_name" :value="item.contractor_name">' +
            '{{ item.contractor_name }}' +
            '</option>' +
            '</select>' +
            '</div>' +
            '<div class="custom-modal-field">' +
            '<label class="custom-modal-label">InterStation</label>' +

            '<el-select v-model="detailForm.selectedSegments" multiple filterable clearable placeholder="Search and select segment">' +
            '<el-option v-for="item in detailForm.linkSegmentList" :key="item.segment_name" :label="item.segment_name" :value="item.segment_name"><span v-if="detailForm.selectedSegments.indexOf(item.segment_name) !== -1" style="display: flex; align-items: center; gap: 10px; width: 100%; color: #0067a8; font-weight: 700;"><span style="display: inline-flex; align-items: center; justify-content: center; width: 18px; height: 18px; box-sizing: border-box; color: #ffffff; background: #0078d4; border: 1px solid #0078d4; border-radius: 4px; font-size: 12px; line-height: 1;">&#10003;</span><span>{{ item.segment_name }}</span></span><span v-else style="display: flex; align-items: center; gap: 10px; width: 100%; color: #263648; font-weight: 400;"><span style="display: inline-block; width: 18px; height: 18px; box-sizing: border-box; background: #ffffff; border: 1px solid #9aa9b8; border-radius: 4px;"></span><span>{{ item.segment_name }}</span></span></el-option>' +
            '</el-select>' +

            // '<select class="custom-form-select" v-model="detailForm.inter_station">' +
            // '<option value="">Please Select</option>' +
            // '<option v-for="item in detailForm.linkSegmentList" :key="item.segment_name"  :value="item.segment_name">' +
            // '{{ item.segment_name }}' +
            // '</option>' +
            // '</select>' +


            '</div>' +
            '<div class="custom-modal-field"><label class="custom-modal-label">{{ detailForm.tt_domain === "DWDM" ? "DWDM" : "MPLS" }} Impact</label><textarea class="custom-form-textarea" v-model="detailForm.impact_mpls"></textarea></div>' +
            '<div class="custom-modal-field"><label class="custom-modal-label">Action</label><textarea class="custom-form-textarea" v-model="detailForm.tt_action"></textarea></div>' +
            '</div>' +
            '<div class="custom-modal-actions">' +
            '<button type="button" class="custom-btn-cancel" @click="closeModal">Cancel</button>' +
            '<button type="button" class="custom-btn-submit" @click="saveDetail">Save</button>' +
            '</div>' +
            '</div>' +
            '</div>' +
            '<div class="custom-modal custom-confirm-modal" :class="{ show: showDeleteModal }" id="deleteModal" @click="closeDeleteModalOnBackdrop">' +
            '<div class="custom-modal-content">' +
            '<div class="custom-confirm-icon"><svg viewBox="0 0 24 24"><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg></div>' +
            '<div class="custom-confirm-title">Delete Work Order</div>' +
            '<div class="custom-confirm-message">Are you sure you want to delete <span class="custom-confirm-id">{{ pendingDeleteId }}</span>?</div>' +
            '<div class="custom-modal-actions">' +
            '<button type="button" class="custom-btn-cancel" @click="closeDeleteModal">Cancel</button>' +
            '<button type="button" class="custom-btn-submit custom-btn-delete" @click="confirmDelete">Delete</button>' +
            '</div>' +
            '</div>' +
            '</div>' +
            '<div class="custom-toast" :class="{ show: toast.show, \'toast-success\': toast.isSuccess }" id="toast">{{ toast.message }}</div>' +
            '</div>',
        data: function () {
            return {
                mplsNum: 0,
                dwdmNum: 0,
                maxTickets: 12,
                tickets: [],
                currentFilter: 'ALL',
                currentDetailData: null,
                pendingDeleteId: null,
                showAddModal: false,
                showDetailModal: false,
                showDeleteModal: false,
                loading: false,
                addForm: {
                    domain: '',
                    ticketId: ''
                },
                detailForm: {
                    orderid: '',
                    title: '',
                    cm_orderid: '',
                    domain: '',
                    inter_station: '',
                    start_time: '',
                    impact_mpls: '',
                    pic: '',
                    tt_action: '',
                    status: '',
                    picList: [],          // 添加这一行
                    linkSegmentList: [],
                    selectedSegments: []

                },
                toast: {
                    show: false,
                    message: '',
                    isSuccess: false
                }
            };
        },
        computed: {
            filteredTickets: function () {
                console.log('this.currentFilter', this.tickets)
                if (this.currentFilter === 'ALL') return this.tickets;
                return this.tickets.filter(function (t) {
                    console.log('currentFilter', this.currentFilter)
                    console.log('tickets', this.tickets)
                    console.log('t-tickets', t.tickets)
                    console.log('tt_domain', this.tickets.tt_domain)
                    console.log('t-tt_domain', t.tt_domain)
                    console.log('t', t)
                    return t.tt_domain === this.currentFilter;
                }, this);
            }
        },
        mounted: function () {
            this.loadData();
            this.timer = setInterval(() => {
                this.loadData();
            }, 3 * 60 * 1000);  // 3分钟 = 180000毫秒

        },
        beforeDestroy() {
            clearInterval(this.timer);  // 组件销毁时清除定时器
        },
        methods: {
            loadData: function () {
                var self = this;
                this.loading = true;
                console.log('[DEBUG] loadData called, currentFilter:', this.currentFilter, 'tickets:', this.tickets);
                queryTicketListService().then(function (res) {
                    console.log('[DEBUG] queryTicketListService resolved, res:', res);
                    self.tickets = res.data || [];
                    self.mplsNum = res.mplsNum;
                    self.dwdmNum = res.dwdmNum;
                    console.log('[DEBUG] tickets after set:', self.tickets, 'length:', self.tickets.length);
                    self.loading = false;
                    console.log('[DEBUG] loading:', self.loading, 'filteredTickets:', self.filteredTickets);

                }).catch(function (err) {
                    self.loading = false;
                    self.showToastErr('Load failed. Please refresh.');
                });

            },
            loadActionContent() {
                // 加载内容后滚动到底部
                this.$nextTick(() => {
                    const actionArr = document.querySelectorAll('.custom-tt-action-content');
                    actionArr.forEach((item) => {
                        if (item) {
                            item.scrollTop = item.scrollHeight;
                        }
                    })

                });
            },
            handleFilter: function (filter) {
                this.currentFilter = filter;
            },
            openAddModal: function () {
                if (this.tickets.length >= this.maxTickets) {
                    this.showToastErr('Maximum 6 work orders. Please delete at least one first.');
                    return;
                }
                this.addForm.domain = 'MPLS';
                this.addForm.ticketId = '';
                this.showAddModal = true;
            },
            closeAddModal: function () {
                this.showAddModal = false;
            },
            closeAddModalOnBackdrop: function (e) {
                if (e.target === e.currentTarget) this.closeAddModal();
            },
            submitTicket: function () {
                var self = this;
                createTicketService({ domain: this.addForm.domain, ticketId: this.addForm.ticketId }).then(function () {
                    self.closeAddModal();
                    // self.loadData();
                    setTimeout(function () {
                        self.loadData();
                    }, 500);
                    self.showToastSucc('Work order created successfully!');
                }).catch(function (err) {
                    self.showToastErr('Create failed: ' + (err.message || 'Unknown error'));
                });
            },

            handleDetails: function (orderId) {
                var self = this;

                // 先显示加载状态
                this.loading = true;

                // 等待所有请求完成后再显示模态框
                Promise.all([
                    queryTicketDetailService(orderId),
                    queryPicListService(),
                    queryLinkSegmentListService()
                ]).then(function (results) {
                    var detail = results[0];
                    var picList = results[1];
                    var linkSegmentList = results[2];

                    self.currentDetailData = Object.assign({}, detail);
                    self.detailForm = Object.assign({}, detail, {
                        picList: picList || [],
                        linkSegmentList: linkSegmentList || [],
                        selectedSegments: detail.selectedSegments || []
                    });
                    self.loading = false;
                    self.showDetailModal = true;
                }).catch(function (err) {
                    self.loading = false;
                    self.showToastErr('Query failed: ' + (err.message || 'Unknown error'));
                });
            },

            handleDel: function (orderId) {
                this.pendingDeleteId = orderId;
                this.showDeleteModal = true;
            },
            closeDeleteModal: function () {
                this.showDeleteModal = false;
                this.pendingDeleteId = null;
            },
            closeDeleteModalOnBackdrop: function (e) {
                if (e.target === e.currentTarget) this.closeDeleteModal();
            },
            confirmDelete: function () {
                var self = this;
                if (!this.pendingDeleteId) return;
                deleteTicketService(this.pendingDeleteId).then(function () {
                    self.closeDeleteModal();
                    setTimeout(function () {
                        self.loadData();
                    }, 500);
                    self.showToastSucc('Work order deleted successfully!');
                }).catch(function (err) {
                    self.showToastErr('Delete failed: ' + (err.message || 'Unknown error'));
                });
            },
            closeModal: function () {
                this.showDetailModal = false;
                this.currentDetailData = null;
            },
            closeDetailModalOnBackdrop: function (e) {
                if (e.target === e.currentTarget) this.closeModal();
            },

            saveDetail: function () {
                var self = this;
                var data = Object.assign({}, this.detailForm);
                updateTicketService(data.orderid, data).then(function () {
                    self.closeModal();
                    setTimeout(function () {
                        self.loadData();
                    }, 500);
                    self.showToastSucc('Save successfully!');
                }).catch(function (err) {
                    self.showToastErr('Save failed: ' + (err.message || 'Unknown error'));
                });
            },
            showToastErr: function (msg) {
                this.showToast(msg, false);
            },
            showToastSucc: function (msg) {
                this.showToast(msg, true);
            },
            showToast: function (msg, isSuccess) {
                var self = this;
                this.toast.message = msg;
                this.toast.isSuccess = isSuccess;
                this.toast.show = true;
                setTimeout(function () { self.toast.show = false; }, 3000);
            }
        }
    });

    if (typeof window.ElementPlus !== 'undefined') { app.use(window.ElementPlus); }
    app.mount(container);
});




function queryTicketListService() {
    return new Promise(function (resolve, reject) {

        MessageProcessor.process({
            serviceId: '/adc-service/rest/v1/services/CN_GSC_ID_Surge_Noc_Dashboard/ticket_dashboard/td_query_tt_info_get_list',
            data: { action: 'queryTicketList' },
            success: function (res) { resolve(res || []); },
            error: function (err) { reject(err); }
        });
    });
}


function queryPicListService() {
    return new Promise(function (resolve, reject) {
        MessageProcessor.process({
            serviceId: '/adc-service/rest/v1/services/datahub/cmdb/cmdb_contractor_getList',
            data: { start: 0, limit: 100 },
            success: function (res) {
                resolve(res.results || []);
            },
            error: function (err) { reject(err); }
        });
    });
}

function queryLinkSegmentListService() {
    return new Promise(function (resolve, reject) {
        MessageProcessor.process({
            serviceId: '/adc-service/rest/v1/services/c_TroubleTicket/TroubleTicket/tt_affected_link_segment_get_list',
            data: { start: 0, limit: 1000, active: true, sort: "segment_name", dir: "ASC" },
            success: function (res) {
                resolve(res.results || []);
            },
            error: function (err) { reject(err); }
        });
    });
}

function queryTicketDetailService(orderId) {
    return new Promise(function (resolve, reject) {
        if (!orderId) { reject(new Error('TT number is required')); return; }
        MessageProcessor.process({
            serviceId: '/adc-service/rest/v1/services/CN_GSC_ID_Surge_Noc_Dashboard/ticket_dashboard/td_query_tt_detail',
            data: { orderid: orderId },
            success: function (res) { resolve(res.data || {}); },
            error: function (err) { reject(err); }
        });
    });
}


function deleteTicketService(orderId) {
    return new Promise(function (resolve, reject) {
        if (!orderId) { reject(new Error('TT number is required')); return; }
        MessageProcessor.process({
            serviceId: '/adc-service/rest/v1/services/CN_GSC_ID_Surge_Noc_Dashboard/ticket_dashboard/td_troubleticket_update',
            data: { orderid: orderId, active: 0 },
            success: function (res) {
                resolve(res.data || { success: true });
                resolve();
            },
            error: function (err) { reject(err); }

        });
        resolve({ success: true, message: 'Deleted successfully' });
    });
}


function createTicketService(data) {
    return new Promise(function (resolve, reject) {
        if (!data.domain || !data.ticketId) { reject(new Error('Missing required parameters')); return; }
        MessageProcessor.process({
            serviceId: '/adc-service/rest/v1/services/CN_GSC_ID_Surge_Noc_Dashboard/ticket_dashboard/td_create_tt_info',
            data: { orderid: data.ticketId, domain: data.domain },
            success: function (res) {
                if (res.code != 200) {
                    reject(new Error(res.message)); return;
                }
                resolve(res.data || []);
            },
            error: function (err) { reject(err); }
        });
    });
}


function updateTicketService(orderId, data) {
    return new Promise(function (resolve, reject) {
        if (!orderId) { reject(new Error('TT number is required')); return; }
        MessageProcessor.process({
            serviceId: '/adc-service/rest/v1/services/CN_GSC_ID_Surge_Noc_Dashboard/ticket_dashboard/td_update_tt_info',
            data: { orderid: orderId, data: data },
            success: function (res) { resolve(res.data || { success: true, data: data }); },
            error: function (err) { reject(err); }
        });
        resolve({ success: true, data: Object.assign({}, data, { id: orderId }) });
    });
}