import { STAGES } from '../../../labels';
import { STATUS_OPTS } from '../leadsManageUtils';

export const EDITABLE_STATUS_OPTS = STATUS_OPTS.filter((status) => status && status !== '已报名');
export const EDITABLE_STAGE_OPTS = STAGES.filter((stage) => stage !== '已报名');
