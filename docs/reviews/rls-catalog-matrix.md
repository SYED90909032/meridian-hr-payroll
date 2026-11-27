# RLS catalog matrix

Generated: 2026-11-27T01:47:25.983Z

| Schema | Table | tenant_id | RLS | Forced | Policies |
|---|---|---:|---:|---:|---|
| ai | conversation | true | true | true | conv_own, tenant_wall |
| ai | message | true | true | true | msg_own, tenant_wall |
| ai | pseudonym | true | true | true | pseudo_own, tenant_wall |
| ai | tenant_setting | true | true | true | tenant_setting_owner, tenant_wall |
| flow | action_token | true | true | true | sys_all, tenant_wall |
| flow | approval_request | true | true | true | insert_own, read_involved, tenant_wall, update_system |
| flow | approval_step | true | true | true | decide_own, insert_own, read_involved, tenant_wall |
| flow | notification | true | true | true | notif_insert, notif_read_own, notif_update_own, tenant_wall |
| kernel | account_token | true | true | true | account_token_auth_rw, account_token_owner_rw |
| kernel | audit_block | true | true | true | audit_block_owner_rw, audit_block_rw, tenant_wall |
| kernel | audit_event | true | true | true | audit_event_owner_rw, audit_read, tenant_wall |
| kernel | audit_head | true | true | true | audit_head_owner_rw |
| kernel | idempotency | true | true | true | open, tenant_wall |
| kernel | legal_hold | true | true | true | legal_hold_owner_rw, open, tenant_wall |
| kernel | login_attempt | false | false | false |  |
| kernel | membership | true | true | true | auth_read, iam_insert, iam_update, read_all, tenant_wall |
| kernel | migration | false | false | false |  |
| kernel | outbox | true | true | true | open, owner_functions, tenant_wall |
| kernel | passkey_credential | false | false | false |  |
| kernel | recovery_code | false | false | false |  |
| kernel | role_assignment | true | true | true | auth_read, iam_insert, iam_update, read_all, tenant_wall |
| kernel | role_assignment_scope | true | true | true | iam_delete, iam_insert, read_all, tenant_wall |
| kernel | role_field_grant | false | false | false |  |
| kernel | scim_token | true | true | true | auth_scim_lookup, auth_scim_touch, open, tenant_wall |
| kernel | session | true | true | true | session_auth_rw, session_owner_rw |
| kernel | sso_config | true | true | true | auth_sso_config_read, open, tenant_wall |
| kernel | sso_group_role | true | true | true | auth_sso_group_read, open, tenant_wall |
| kernel | sso_state | true | true | true | auth_state_access, open, tenant_wall |
| kernel | subject_key | true | true | true | open, owner_subject_key_migration_read, subject_key_owner_rw, tenant_wall |
| kernel | tenant | false | true | true | tenant_auth, tenant_insert, tenant_read, tenant_update |
| kernel | tenant_key | true | true | true | open, owner_tenant_key_migration_read, tenant_wall |
| kernel | tenant_mfa_policy | true | true | true | auth_read, open, tenant_wall |
| kernel | user_account | false | false | false |  |
| kernel | watchdog_alert | true | true | true | open, tenant_wall, watchdog_owner |
| kernel | webauthn_challenge | false | false | false |  |
| pay | adjustment | true | true | true | pay_read, pay_write_i, pay_write_u, tenant_wall |
| pay | bank_acknowledgement | true | true | true | bank_ack_insert, bank_ack_read, tenant_wall |
| pay | bank_submission | true | true | true | bank_submission_insert, bank_submission_read, bank_submission_update, tenant_wall |
| pay | pack_registry | false | false | false |  |
| pay | pack_signoff | false | false | false |  |
| pay | parallel_run | true | true | true | parallel_insert, parallel_owner_evidence_read, parallel_read, parallel_update, tenant_wall |
| pay | parallel_run_employee | true | true | true | parallel_employee_insert, parallel_employee_read, parallel_employee_update, tenant_wall |
| pay | pay_group | true | true | true | open, tenant_wall |
| pay | pay_result | true | true | true | scope_insert, scope_read, scope_update, self_result_read, sys_result_ins, sys_result_read, sys_result_upd, tenant_wall |
| pay | pay_run | true | true | true | pay_read, pay_run_owner_evidence_read, pay_write_i, pay_write_u, tenant_wall |
| pay | pay_run_approval | true | true | true | pay_read, pay_write_i, pay_write_u, tenant_wall |
| pay | payment_file | true | true | true | pay_read, pay_write_i, pay_write_u, tenant_wall |
| pay | payroll_exception | true | true | true | pay_read, pay_write_i, pay_write_u, tenant_wall |
| pay | payroll_input_snapshot | true | true | true | pay_read, pay_write_i, pay_write_u, tenant_wall |
| pay | payroll_policy_exception | true | true | true | open, tenant_wall |
| pay | payslip | true | true | true | scope_insert, scope_read, scope_update, self_payslip_read, sys_payslip_ins, sys_payslip_read, sys_payslip_upd, tenant_wall |
| pay | reconciliation | true | true | true | pay_read, pay_write_i, pay_write_u, tenant_wall |
| pay | run_event | true | true | true | open, tenant_wall |
| pay | run_transition | false | false | false |  |
| people | compensation | true | true | true | scope_insert, scope_read, scope_update, self_read, tenant_wall |
| people | document | true | true | true | owner_document_migration_read, owner_document_migration_update, scope_delete, scope_insert, scope_read, scope_update, self_read, tenant_wall |
| people | employee | true | true | true | hr_insert, hr_update, read_all, tenant_wall |
| people | employee_bank | true | true | true | scope_insert, scope_read, scope_update, self_read, tenant_wall |
| people | employee_event | true | true | true | open, tenant_wall |
| people | employee_private | true | true | true | scope_insert, scope_read, scope_update, self_read, tenant_wall |
| people | org_unit | true | true | true | open, tenant_wall |
| plat | api_key | true | true | true | auth_lookup, auth_touch, open, tenant_wall |
| plat | webhook_allowlist | true | true | true | open, tenant_wall |
| plat | webhook_delivery | true | true | true | open, tenant_wall |
| plat | webhook_endpoint | true | true | true | open, tenant_wall |
| svc | announcement | true | true | true | open, tenant_wall |
| svc | kb_article | true | true | true | open, tenant_wall |
| svc | ticket | true | true | true | tenant_wall, ticket_insert_self, ticket_self, ticket_self_update, ticket_staff_read, ticket_staff_update |
| svc | ticket_comment | true | true | true | comment_insert, comment_read, tenant_wall |
| tm | attendance_day | true | true | true | scope_insert, scope_read, scope_update, self_read, sys_read, system_ins_att, system_upd_att, tenant_wall |
| tm | device | true | true | true | auth_lookup, auth_touch, open, tenant_wall |
| tm | late_punch_review | true | true | true | read_team, sys_insert, sys_update, tenant_wall |
| tm | leave_ledger | true | true | true | scope_read, self_read, sys_insert, sys_read, tenant_wall |
| tm | leave_reason | true | true | true | scope_insert, scope_read, scope_update, self_insert_reason, self_read, tenant_wall |
| tm | leave_request | true | true | true | flow_update_leave, scope_insert, scope_read, scope_update, self_insert_leave, self_read, sys_read_leave, tenant_wall |
| tm | leave_type | true | true | true | open, tenant_wall |
| tm | public_holiday | true | true | true | open, tenant_wall |
| tm | punch | true | true | true | scope_insert, scope_read, scope_update, self_read, sys_read, system_insert, tenant_wall |
| tm | punch_dedupe | true | true | true | open, tenant_wall |
| tm | shift | true | true | true | open, tenant_wall |
| tm | shift_assignment | true | true | true | read_team, sys_write, tenant_wall |

## Runtime roles

| Role | Superuser | BYPASSRLS | Owned tables |
|---|---:|---:|---|
| meridian_app | false | false | none |
| meridian_auth | false | false | none |
| meridian_worker | false | false | none |

Global reference exceptions are tables without tenant_id whose contents are intentionally shared (for example pay.pack_registry and kernel.role_field_grant). All rows with tenant_id remain tenant-scoped.
