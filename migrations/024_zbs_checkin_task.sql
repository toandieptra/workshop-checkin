INSERT INTO zbs_task_configs (task_key, task_label, enabled, template_id)
VALUES ('checkin_confirmation', 'Xác nhận Check-in Workshop', false, '610839')
ON CONFLICT (task_key) DO UPDATE
SET task_label = EXCLUDED.task_label,
    template_id = COALESCE(zbs_task_configs.template_id, EXCLUDED.template_id);
