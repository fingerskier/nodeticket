-- Nodeticket Database Schema for MySQL
-- Tables use the ost_ prefix by default (configurable via TABLE_PREFIX env var).

-- ============================================================
-- Configuration & System
-- ============================================================

CREATE TABLE ost_config (
  id INT(11) UNSIGNED NOT NULL AUTO_INCREMENT,
  namespace VARCHAR(64) NOT NULL,
  `key` VARCHAR(64) NOT NULL,
  value TEXT NOT NULL,
  updated TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY (namespace, `key`)
);

INSERT INTO ost_config (namespace, `key`, value) VALUES
  ('core', 'admin_email', ''),
  ('core', 'helpdesk_url', ''),
  ('core', 'helpdesk_title', ''),
  ('core', 'schema_signature', '');

CREATE TABLE ost_sequence (
  id INT(11) UNSIGNED NOT NULL AUTO_INCREMENT,
  name VARCHAR(64) DEFAULT NULL,
  flags INT(10) UNSIGNED DEFAULT NULL,
  next BIGINT(20) UNSIGNED NOT NULL DEFAULT 1,
  increment INT(11) DEFAULT 1,
  padding CHAR(1) DEFAULT '0',
  updated DATETIME NOT NULL,
  PRIMARY KEY (id)
) ENGINE=InnoDB;

CREATE TABLE ost_syslog (
  log_id INT(11) UNSIGNED NOT NULL AUTO_INCREMENT,
  log_type ENUM('Debug','Warning','Error') NOT NULL,
  title VARCHAR(255) NOT NULL,
  log TEXT NOT NULL,
  logger VARCHAR(64) NOT NULL,
  ip_address VARCHAR(64) NOT NULL,
  created DATETIME NOT NULL,
  updated DATETIME NOT NULL,
  PRIMARY KEY (log_id),
  KEY log_type (log_type)
);

CREATE TABLE ost_session (
  session_id VARCHAR(255) COLLATE ascii_general_ci NOT NULL DEFAULT '',
  session_data BLOB,
  session_expire DATETIME DEFAULT NULL,
  session_updated DATETIME DEFAULT NULL,
  user_id VARCHAR(16) NOT NULL DEFAULT '0',
  user_ip VARCHAR(64) NOT NULL,
  user_agent VARCHAR(255) COLLATE utf8_unicode_ci NOT NULL,
  PRIMARY KEY (session_id),
  KEY updated (session_updated),
  KEY user_id (user_id)
) DEFAULT CHARSET=utf8 COLLATE=utf8_unicode_ci;

CREATE TABLE ost_event (
  id INT(10) UNSIGNED NOT NULL AUTO_INCREMENT,
  name VARCHAR(60) NOT NULL,
  description VARCHAR(60) DEFAULT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY name (name)
) ENGINE=InnoDB;

CREATE TABLE ost_api_key (
  id INT(10) UNSIGNED NOT NULL AUTO_INCREMENT,
  isactive TINYINT(1) NOT NULL DEFAULT 1,
  ipaddr VARCHAR(64) NOT NULL,
  apikey VARCHAR(255) NOT NULL,
  can_create_tickets TINYINT(1) UNSIGNED NOT NULL DEFAULT 1,
  can_exec_cron TINYINT(1) UNSIGNED NOT NULL DEFAULT 1,
  notes TEXT,
  updated DATETIME NOT NULL,
  created DATETIME NOT NULL,
  PRIMARY KEY (id),
  KEY ipaddr (ipaddr),
  UNIQUE KEY apikey (apikey)
);

-- ============================================================
-- Users & Organizations
-- ============================================================

CREATE TABLE ost_user (
  id INT(10) UNSIGNED NOT NULL AUTO_INCREMENT,
  org_id INT(10) UNSIGNED NOT NULL,
  default_email_id INT(10) NOT NULL,
  status INT(11) UNSIGNED NOT NULL DEFAULT 0,
  name VARCHAR(128) NOT NULL,
  created DATETIME NOT NULL,
  updated DATETIME NOT NULL,
  PRIMARY KEY (id),
  KEY org_id (org_id),
  KEY default_email_id (default_email_id),
  KEY name (name)
);

CREATE TABLE ost_user_email (
  id INT(10) UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id INT(10) UNSIGNED NOT NULL,
  flags INT(10) UNSIGNED NOT NULL DEFAULT 0,
  address VARCHAR(255) NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY address (address),
  KEY user_email_lookup (user_id)
);

CREATE TABLE ost_user_account (
  id INT(11) UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id INT(10) UNSIGNED NOT NULL,
  status INT(11) UNSIGNED NOT NULL DEFAULT 0,
  timezone VARCHAR(64) DEFAULT NULL,
  lang VARCHAR(16) DEFAULT NULL,
  username VARCHAR(64) DEFAULT NULL,
  passwd VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  backend VARCHAR(32) DEFAULT NULL,
  extra TEXT,
  registered TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY user_id (user_id),
  UNIQUE KEY username (username)
);

CREATE TABLE ost_organization (
  id INT(11) UNSIGNED NOT NULL AUTO_INCREMENT,
  name VARCHAR(128) NOT NULL DEFAULT '',
  manager VARCHAR(16) NOT NULL DEFAULT '',
  status INT(11) UNSIGNED NOT NULL DEFAULT 0,
  domain VARCHAR(256) NOT NULL DEFAULT '',
  extra TEXT,
  created TIMESTAMP NULL DEFAULT NULL,
  updated TIMESTAMP NULL DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id)
);

-- ============================================================
-- Staff & Access Control
-- ============================================================

CREATE TABLE ost_staff (
  staff_id INT(11) UNSIGNED NOT NULL AUTO_INCREMENT,
  dept_id INT(10) UNSIGNED NOT NULL DEFAULT 0,
  role_id INT(10) UNSIGNED NOT NULL DEFAULT 0,
  username VARCHAR(32) NOT NULL DEFAULT '',
  firstname VARCHAR(32) DEFAULT NULL,
  lastname VARCHAR(32) DEFAULT NULL,
  passwd VARCHAR(128) DEFAULT NULL,
  backend VARCHAR(32) DEFAULT NULL,
  email VARCHAR(255) DEFAULT NULL,
  phone VARCHAR(24) NOT NULL DEFAULT '',
  phone_ext VARCHAR(6) DEFAULT NULL,
  mobile VARCHAR(24) NOT NULL DEFAULT '',
  signature TEXT NOT NULL,
  lang VARCHAR(16) DEFAULT NULL,
  timezone VARCHAR(64) DEFAULT NULL,
  locale VARCHAR(16) DEFAULT NULL,
  notes TEXT,
  isactive TINYINT(1) NOT NULL DEFAULT 1,
  isadmin TINYINT(1) NOT NULL DEFAULT 0,
  isvisible TINYINT(1) UNSIGNED NOT NULL DEFAULT 1,
  onvacation TINYINT(1) UNSIGNED NOT NULL DEFAULT 0,
  assigned_only TINYINT(1) UNSIGNED NOT NULL DEFAULT 0,
  show_assigned_tickets TINYINT(1) UNSIGNED NOT NULL DEFAULT 0,
  change_passwd TINYINT(1) UNSIGNED NOT NULL DEFAULT 0,
  max_page_size INT(11) UNSIGNED NOT NULL DEFAULT 0,
  auto_refresh_rate INT(10) UNSIGNED NOT NULL DEFAULT 0,
  default_signature_type ENUM('none','mine','dept') NOT NULL DEFAULT 'none',
  default_paper_size ENUM('Letter','Legal','Ledger','A4','A3') NOT NULL DEFAULT 'Letter',
  extra TEXT,
  permissions TEXT,
  created DATETIME NOT NULL,
  lastlogin DATETIME DEFAULT NULL,
  passwdreset DATETIME DEFAULT NULL,
  updated DATETIME NOT NULL,
  PRIMARY KEY (staff_id),
  UNIQUE KEY username (username),
  KEY dept_id (dept_id),
  KEY issuperuser (isadmin),
  KEY isactive (isactive),
  KEY onvacation (onvacation)
);

CREATE TABLE ost_staff_dept_access (
  staff_id INT(10) UNSIGNED NOT NULL DEFAULT 0,
  dept_id INT(10) UNSIGNED NOT NULL DEFAULT 0,
  role_id INT(10) UNSIGNED NOT NULL DEFAULT 0,
  flags INT(10) UNSIGNED NOT NULL DEFAULT 1,
  PRIMARY KEY (staff_id, dept_id),
  KEY dept_id (dept_id)
);

CREATE TABLE ost_role (
  id INT(11) UNSIGNED NOT NULL AUTO_INCREMENT,
  flags INT(10) UNSIGNED NOT NULL DEFAULT 1,
  name VARCHAR(64) DEFAULT NULL,
  permissions TEXT,
  notes TEXT,
  created DATETIME NOT NULL,
  updated DATETIME NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY name (name)
);

CREATE TABLE `ost_group` (
  id INT(10) UNSIGNED NOT NULL AUTO_INCREMENT,
  role_id INT(11) UNSIGNED NOT NULL,
  flags INT(11) UNSIGNED NOT NULL DEFAULT 1,
  name VARCHAR(120) NOT NULL DEFAULT '',
  notes TEXT,
  created DATETIME NOT NULL,
  updated DATETIME NOT NULL,
  PRIMARY KEY (id),
  KEY role_id (role_id)
);

-- ============================================================
-- Departments & Teams
-- ============================================================

CREATE TABLE ost_department (
  id INT(11) UNSIGNED NOT NULL AUTO_INCREMENT,
  pid INT(11) UNSIGNED DEFAULT NULL,
  tpl_id INT(10) UNSIGNED NOT NULL DEFAULT 0,
  sla_id INT(10) UNSIGNED NOT NULL DEFAULT 0,
  schedule_id INT(10) UNSIGNED NOT NULL DEFAULT 0,
  email_id INT(10) UNSIGNED NOT NULL DEFAULT 0,
  autoresp_email_id INT(10) UNSIGNED NOT NULL DEFAULT 0,
  manager_id INT(10) UNSIGNED NOT NULL DEFAULT 0,
  flags INT(10) UNSIGNED NOT NULL DEFAULT 0,
  name VARCHAR(128) NOT NULL DEFAULT '',
  signature TEXT NOT NULL,
  ispublic TINYINT(1) UNSIGNED NOT NULL DEFAULT 1,
  group_membership TINYINT(1) NOT NULL DEFAULT 0,
  ticket_auto_response TINYINT(1) NOT NULL DEFAULT 1,
  message_auto_response TINYINT(1) NOT NULL DEFAULT 0,
  path VARCHAR(128) NOT NULL DEFAULT '/',
  updated DATETIME NOT NULL,
  created DATETIME NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY name (name, pid),
  KEY manager_id (manager_id),
  KEY autoresp_email_id (autoresp_email_id),
  KEY tpl_id (tpl_id),
  KEY flags (flags)
);

CREATE TABLE ost_team (
  team_id INT(10) UNSIGNED NOT NULL AUTO_INCREMENT,
  lead_id INT(10) UNSIGNED NOT NULL DEFAULT 0,
  flags INT(10) UNSIGNED NOT NULL DEFAULT 1,
  name VARCHAR(125) NOT NULL DEFAULT '',
  notes TEXT,
  created DATETIME NOT NULL,
  updated DATETIME NOT NULL,
  PRIMARY KEY (team_id),
  UNIQUE KEY name (name),
  KEY lead_id (lead_id)
);

CREATE TABLE ost_team_member (
  team_id INT(10) UNSIGNED NOT NULL DEFAULT 0,
  staff_id INT(10) UNSIGNED NOT NULL,
  flags INT(10) UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (team_id, staff_id),
  KEY staff_id (staff_id)
);

-- ============================================================
-- Tickets
-- ============================================================

CREATE TABLE ost_ticket (
  ticket_id INT(11) UNSIGNED NOT NULL AUTO_INCREMENT,
  ticket_pid INT(11) UNSIGNED DEFAULT NULL,
  number VARCHAR(20),
  user_id INT(11) UNSIGNED NOT NULL DEFAULT 0,
  user_email_id INT(11) UNSIGNED NOT NULL DEFAULT 0,
  status_id INT(10) UNSIGNED NOT NULL DEFAULT 0,
  dept_id INT(10) UNSIGNED NOT NULL DEFAULT 0,
  sla_id INT(10) UNSIGNED NOT NULL DEFAULT 0,
  topic_id INT(10) UNSIGNED NOT NULL DEFAULT 0,
  staff_id INT(10) UNSIGNED NOT NULL DEFAULT 0,
  team_id INT(10) UNSIGNED NOT NULL DEFAULT 0,
  email_id INT(11) UNSIGNED NOT NULL DEFAULT 0,
  lock_id INT(11) UNSIGNED NOT NULL DEFAULT 0,
  flags INT(10) UNSIGNED NOT NULL DEFAULT 0,
  sort INT(11) UNSIGNED NOT NULL DEFAULT 0,
  ip_address VARCHAR(64) NOT NULL DEFAULT '',
  source ENUM('Web','Email','Phone','API','Other') NOT NULL DEFAULT 'Other',
  source_extra VARCHAR(40) NULL DEFAULT NULL,
  isoverdue TINYINT(1) UNSIGNED NOT NULL DEFAULT 0,
  isanswered TINYINT(1) UNSIGNED NOT NULL DEFAULT 0,
  duedate DATETIME DEFAULT NULL,
  est_duedate DATETIME DEFAULT NULL,
  reopened DATETIME DEFAULT NULL,
  closed DATETIME DEFAULT NULL,
  lastupdate DATETIME DEFAULT NULL,
  created DATETIME NOT NULL,
  updated DATETIME NOT NULL,
  PRIMARY KEY (ticket_id),
  KEY user_id (user_id),
  KEY dept_id (dept_id),
  KEY staff_id (staff_id),
  KEY team_id (team_id),
  KEY status_id (status_id),
  KEY created (created),
  KEY closed (closed),
  KEY duedate (duedate),
  KEY topic_id (topic_id),
  KEY sla_id (sla_id),
  KEY ticket_pid (ticket_pid)
);

CREATE TABLE IF NOT EXISTS ost_ticket_status (
  id INT(11) NOT NULL AUTO_INCREMENT,
  name VARCHAR(60) NOT NULL DEFAULT '',
  state VARCHAR(16) DEFAULT NULL,
  mode INT(11) UNSIGNED NOT NULL DEFAULT 0,
  flags INT(11) UNSIGNED NOT NULL DEFAULT 0,
  sort INT(11) UNSIGNED NOT NULL DEFAULT 0,
  properties TEXT NOT NULL,
  created DATETIME NOT NULL,
  updated DATETIME NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY name (name),
  KEY state (state)
);

CREATE TABLE ost_ticket_priority (
  priority_id TINYINT(4) NOT NULL AUTO_INCREMENT,
  priority VARCHAR(60) NOT NULL DEFAULT '',
  priority_desc VARCHAR(30) NOT NULL DEFAULT '',
  priority_color VARCHAR(7) NOT NULL DEFAULT '',
  priority_urgency TINYINT(1) UNSIGNED NOT NULL DEFAULT 0,
  ispublic TINYINT(1) NOT NULL DEFAULT 1,
  PRIMARY KEY (priority_id),
  UNIQUE KEY priority (priority),
  KEY priority_urgency (priority_urgency),
  KEY ispublic (ispublic)
);

CREATE TABLE ost_lock (
  lock_id INT(11) UNSIGNED NOT NULL AUTO_INCREMENT,
  staff_id INT(10) UNSIGNED NOT NULL DEFAULT 0,
  expire DATETIME DEFAULT NULL,
  code VARCHAR(20),
  created DATETIME NOT NULL,
  PRIMARY KEY (lock_id),
  KEY staff_id (staff_id)
);

-- ============================================================
-- Threads & Communication
-- ============================================================

CREATE TABLE IF NOT EXISTS ost_thread (
  id INT(11) UNSIGNED NOT NULL AUTO_INCREMENT,
  object_id INT(11) UNSIGNED NOT NULL,
  object_type CHAR(1) NOT NULL,
  extra TEXT,
  lastresponse DATETIME DEFAULT NULL,
  lastmessage DATETIME DEFAULT NULL,
  created DATETIME NOT NULL,
  PRIMARY KEY (id),
  KEY object_id (object_id),
  KEY object_type (object_type)
);

CREATE TABLE ost_thread_entry (
  id INT(11) UNSIGNED NOT NULL AUTO_INCREMENT,
  pid INT(11) UNSIGNED NOT NULL DEFAULT 0,
  thread_id INT(11) UNSIGNED NOT NULL DEFAULT 0,
  staff_id INT(11) UNSIGNED NOT NULL DEFAULT 0,
  user_id INT(11) UNSIGNED NOT NULL DEFAULT 0,
  type CHAR(1) NOT NULL DEFAULT '',
  flags INT(11) UNSIGNED NOT NULL DEFAULT 0,
  poster VARCHAR(128) NOT NULL DEFAULT '',
  editor INT(10) UNSIGNED NULL,
  editor_type CHAR(1) NULL,
  source VARCHAR(32) NOT NULL DEFAULT '',
  title VARCHAR(255),
  body TEXT NOT NULL,
  format VARCHAR(16) NOT NULL DEFAULT 'html',
  ip_address VARCHAR(64) NOT NULL DEFAULT '',
  extra TEXT,
  recipients TEXT,
  created DATETIME NOT NULL,
  updated DATETIME NOT NULL,
  PRIMARY KEY (id),
  KEY pid (pid),
  KEY thread_id (thread_id),
  KEY staff_id (staff_id),
  KEY type (type)
);

CREATE TABLE ost_thread_entry_email (
  id INT(11) UNSIGNED NOT NULL AUTO_INCREMENT,
  thread_entry_id INT(11) UNSIGNED NOT NULL,
  email_id INT(11) UNSIGNED DEFAULT NULL,
  mid VARCHAR(255) NOT NULL,
  headers TEXT,
  PRIMARY KEY (id),
  KEY thread_entry_id (thread_entry_id),
  KEY mid (mid),
  KEY email_id (email_id)
);

CREATE TABLE ost_thread_entry_merge (
  id INT(11) UNSIGNED NOT NULL AUTO_INCREMENT,
  thread_entry_id INT(11) UNSIGNED NOT NULL,
  data TEXT,
  PRIMARY KEY (id),
  KEY thread_entry_id (thread_entry_id)
);

CREATE TABLE ost_thread_event (
  id INT(10) UNSIGNED NOT NULL AUTO_INCREMENT,
  thread_id INT(11) UNSIGNED NOT NULL DEFAULT 0,
  thread_type CHAR(1) NOT NULL DEFAULT '',
  event_id INT(11) UNSIGNED DEFAULT NULL,
  staff_id INT(11) UNSIGNED NOT NULL,
  team_id INT(11) UNSIGNED NOT NULL,
  dept_id INT(11) UNSIGNED NOT NULL,
  topic_id INT(11) UNSIGNED NOT NULL,
  data VARCHAR(1024) DEFAULT NULL,
  username VARCHAR(128) NOT NULL DEFAULT 'SYSTEM',
  uid INT(11) UNSIGNED DEFAULT NULL,
  uid_type CHAR(1) NOT NULL DEFAULT 'S',
  annulled TINYINT(1) UNSIGNED NOT NULL DEFAULT 0,
  timestamp DATETIME NOT NULL,
  PRIMARY KEY (id),
  KEY ticket_state (thread_id, event_id, timestamp),
  KEY ticket_stats (timestamp, event_id)
);

CREATE TABLE ost_thread_referral (
  id INT(10) UNSIGNED NOT NULL AUTO_INCREMENT,
  thread_id INT(11) UNSIGNED NOT NULL,
  object_id INT(11) UNSIGNED NOT NULL,
  object_type CHAR(1) NOT NULL,
  created DATETIME NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY ref_lookup (object_id, object_type, thread_id),
  KEY thread_id (thread_id)
) ENGINE=InnoDB;

CREATE TABLE ost_thread_collaborator (
  id INT(11) UNSIGNED NOT NULL AUTO_INCREMENT,
  flags INT(10) UNSIGNED NOT NULL DEFAULT 1,
  thread_id INT(11) UNSIGNED NOT NULL DEFAULT 0,
  user_id INT(11) UNSIGNED NOT NULL DEFAULT 0,
  role CHAR(1) NOT NULL DEFAULT 'M',
  created DATETIME NOT NULL,
  updated DATETIME NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY collab (thread_id, user_id),
  KEY user_id (user_id)
);

-- ============================================================
-- Tasks
-- ============================================================

CREATE TABLE ost_task (
  id INT(11) UNSIGNED NOT NULL AUTO_INCREMENT,
  object_id INT(11) NOT NULL DEFAULT 0,
  object_type CHAR(1) NOT NULL,
  number VARCHAR(20) DEFAULT NULL,
  dept_id INT(10) UNSIGNED NOT NULL DEFAULT 0,
  staff_id INT(10) UNSIGNED NOT NULL DEFAULT 0,
  team_id INT(10) UNSIGNED NOT NULL DEFAULT 0,
  lock_id INT(11) UNSIGNED NOT NULL DEFAULT 0,
  flags INT(10) UNSIGNED NOT NULL DEFAULT 0,
  duedate DATETIME DEFAULT NULL,
  closed DATETIME DEFAULT NULL,
  created DATETIME NOT NULL,
  updated DATETIME NOT NULL,
  PRIMARY KEY (id),
  KEY dept_id (dept_id),
  KEY staff_id (staff_id),
  KEY team_id (team_id),
  KEY created (created),
  KEY object_lookup (object_id, object_type),
  KEY flags (flags)
);

-- ============================================================
-- Email & Notifications
-- ============================================================

CREATE TABLE ost_email (
  email_id INT(11) UNSIGNED NOT NULL AUTO_INCREMENT,
  noautoresp TINYINT(1) UNSIGNED NOT NULL DEFAULT 0,
  priority_id INT(11) UNSIGNED NOT NULL DEFAULT 2,
  dept_id INT(11) UNSIGNED NOT NULL DEFAULT 0,
  topic_id INT(11) UNSIGNED NOT NULL DEFAULT 0,
  email VARCHAR(255) NOT NULL DEFAULT '',
  name VARCHAR(255) NOT NULL DEFAULT '',
  notes TEXT DEFAULT NULL,
  created DATETIME NOT NULL,
  updated DATETIME NOT NULL,
  PRIMARY KEY (email_id),
  UNIQUE KEY email (email),
  KEY priority_id (priority_id),
  KEY dept_id (dept_id)
);

CREATE TABLE ost_email_account (
  id INT(11) UNSIGNED NOT NULL AUTO_INCREMENT,
  email_id INT(11) UNSIGNED NOT NULL,
  type ENUM('mailbox','smtp') NOT NULL DEFAULT 'mailbox',
  auth_bk VARCHAR(128) NOT NULL,
  auth_id VARCHAR(16) DEFAULT NULL,
  active TINYINT(1) UNSIGNED NOT NULL DEFAULT 0,
  host VARCHAR(128) NOT NULL DEFAULT '',
  port INT(11) NOT NULL,
  folder VARCHAR(255) DEFAULT NULL,
  protocol ENUM('IMAP','POP','SMTP','OTHER') NOT NULL DEFAULT 'OTHER',
  encryption ENUM('NONE','AUTO','SSL') NOT NULL DEFAULT 'AUTO',
  fetchfreq TINYINT(3) UNSIGNED NOT NULL DEFAULT 5,
  fetchmax TINYINT(4) UNSIGNED DEFAULT 30,
  postfetch ENUM('archive','delete','nothing') NOT NULL DEFAULT 'nothing',
  archivefolder VARCHAR(255) DEFAULT NULL,
  allow_spoofing TINYINT(1) UNSIGNED DEFAULT 0,
  num_errors INT(11) UNSIGNED NOT NULL DEFAULT 0,
  last_error_msg TINYTEXT DEFAULT NULL,
  last_error DATETIME DEFAULT NULL,
  last_activity DATETIME DEFAULT NULL,
  created DATETIME NOT NULL,
  updated DATETIME NOT NULL DEFAULT '0000-00-00 00:00:00',
  PRIMARY KEY (id),
  KEY email_id (email_id),
  KEY type (type)
);

CREATE TABLE ost_email_template_group (
  tpl_id INT(11) NOT NULL AUTO_INCREMENT,
  isactive TINYINT(1) UNSIGNED NOT NULL DEFAULT 0,
  name VARCHAR(32) NOT NULL DEFAULT '',
  lang VARCHAR(16) NOT NULL DEFAULT 'en_US',
  notes TEXT,
  created DATETIME NOT NULL,
  updated TIMESTAMP NOT NULL,
  PRIMARY KEY (tpl_id)
);

CREATE TABLE ost_email_template (
  id INT(11) UNSIGNED NOT NULL AUTO_INCREMENT,
  tpl_id INT(11) UNSIGNED NOT NULL,
  code_name VARCHAR(32) NOT NULL,
  subject VARCHAR(255) NOT NULL DEFAULT '',
  body TEXT NOT NULL,
  notes TEXT,
  created DATETIME NOT NULL,
  updated DATETIME NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY template_lookup (tpl_id, code_name)
);

CREATE TABLE ost_canned_response (
  canned_id INT(10) UNSIGNED NOT NULL AUTO_INCREMENT,
  dept_id INT(10) UNSIGNED NOT NULL DEFAULT 0,
  isenabled TINYINT(1) UNSIGNED NOT NULL DEFAULT 1,
  title VARCHAR(255) NOT NULL DEFAULT '',
  response TEXT NOT NULL,
  lang VARCHAR(16) NOT NULL DEFAULT 'en_US',
  notes TEXT,
  created DATETIME NOT NULL,
  updated DATETIME NOT NULL,
  PRIMARY KEY (canned_id),
  UNIQUE KEY title (title),
  KEY dept_id (dept_id),
  KEY active (isenabled)
);

-- ============================================================
-- Help Topics & Knowledge Base
-- ============================================================

CREATE TABLE ost_help_topic (
  topic_id INT(11) UNSIGNED NOT NULL AUTO_INCREMENT,
  topic_pid INT(10) UNSIGNED NOT NULL DEFAULT 0,
  ispublic TINYINT(1) UNSIGNED NOT NULL DEFAULT 1,
  noautoresp TINYINT(3) UNSIGNED NOT NULL DEFAULT 0,
  flags INT(10) UNSIGNED DEFAULT 0,
  status_id INT(10) UNSIGNED NOT NULL DEFAULT 0,
  priority_id INT(10) UNSIGNED NOT NULL DEFAULT 0,
  dept_id INT(10) UNSIGNED NOT NULL DEFAULT 0,
  staff_id INT(10) UNSIGNED NOT NULL DEFAULT 0,
  team_id INT(10) UNSIGNED NOT NULL DEFAULT 0,
  sla_id INT(10) UNSIGNED NOT NULL DEFAULT 0,
  page_id INT(10) UNSIGNED NOT NULL DEFAULT 0,
  sequence_id INT(10) UNSIGNED NOT NULL DEFAULT 0,
  sort INT(10) UNSIGNED NOT NULL DEFAULT 0,
  topic VARCHAR(128) NOT NULL DEFAULT '',
  number_format VARCHAR(32) DEFAULT NULL,
  notes TEXT,
  created DATETIME NOT NULL,
  updated DATETIME NOT NULL,
  PRIMARY KEY (topic_id),
  UNIQUE KEY topic (topic, topic_pid),
  KEY topic_pid (topic_pid),
  KEY priority_id (priority_id),
  KEY dept_id (dept_id),
  KEY staff_id (staff_id, team_id),
  KEY sla_id (sla_id),
  KEY page_id (page_id)
);

CREATE TABLE ost_help_topic_form (
  id INT(11) UNSIGNED NOT NULL AUTO_INCREMENT,
  topic_id INT(11) UNSIGNED NOT NULL DEFAULT 0,
  form_id INT(10) UNSIGNED NOT NULL DEFAULT 0,
  sort INT(10) UNSIGNED NOT NULL DEFAULT 1,
  extra TEXT,
  PRIMARY KEY (id),
  KEY topic_form (topic_id, form_id)
);

CREATE TABLE IF NOT EXISTS ost_faq (
  faq_id INT(10) UNSIGNED NOT NULL AUTO_INCREMENT,
  category_id INT(10) UNSIGNED NOT NULL DEFAULT 0,
  ispublished TINYINT(1) UNSIGNED NOT NULL DEFAULT 0,
  question VARCHAR(255) NOT NULL,
  answer TEXT NOT NULL,
  keywords TINYTEXT,
  notes TEXT,
  created DATETIME NOT NULL,
  updated DATETIME NOT NULL,
  PRIMARY KEY (faq_id),
  UNIQUE KEY question (question),
  KEY category_id (category_id),
  KEY ispublished (ispublished)
);

CREATE TABLE IF NOT EXISTS ost_faq_category (
  category_id INT(10) UNSIGNED NOT NULL AUTO_INCREMENT,
  category_pid INT(10) UNSIGNED DEFAULT NULL,
  ispublic TINYINT(1) UNSIGNED NOT NULL DEFAULT 0,
  name VARCHAR(125) DEFAULT NULL,
  description TEXT NOT NULL,
  notes TINYTEXT NOT NULL,
  created DATETIME NOT NULL,
  updated DATETIME NOT NULL,
  PRIMARY KEY (category_id),
  KEY (ispublic)
);

CREATE TABLE IF NOT EXISTS ost_faq_topic (
  faq_id INT(10) UNSIGNED NOT NULL,
  topic_id INT(10) UNSIGNED NOT NULL,
  PRIMARY KEY (faq_id, topic_id)
);

-- ============================================================
-- Dynamic Forms & Custom Fields
-- ============================================================

CREATE TABLE ost_form (
  id INT(11) UNSIGNED NOT NULL AUTO_INCREMENT,
  pid INT(10) UNSIGNED DEFAULT NULL,
  type VARCHAR(8) NOT NULL DEFAULT 'G',
  flags INT(10) UNSIGNED NOT NULL DEFAULT 1,
  title VARCHAR(255) NOT NULL,
  instructions VARCHAR(512),
  name VARCHAR(64) NOT NULL DEFAULT '',
  notes TEXT,
  created DATETIME NOT NULL,
  updated DATETIME NOT NULL,
  PRIMARY KEY (id),
  KEY type (type)
);

CREATE TABLE ost_form_field (
  id INT(11) UNSIGNED NOT NULL AUTO_INCREMENT,
  form_id INT(11) UNSIGNED NOT NULL,
  flags INT(10) UNSIGNED DEFAULT 1,
  type VARCHAR(255) NOT NULL DEFAULT 'text',
  label VARCHAR(255) NOT NULL,
  name VARCHAR(64) NOT NULL,
  configuration TEXT,
  sort INT(11) UNSIGNED NOT NULL,
  hint VARCHAR(512),
  created DATETIME NOT NULL,
  updated DATETIME NOT NULL,
  PRIMARY KEY (id),
  KEY form_id (form_id),
  KEY sort (sort)
);

CREATE TABLE ost_form_entry (
  id INT(11) UNSIGNED NOT NULL AUTO_INCREMENT,
  form_id INT(11) UNSIGNED NOT NULL,
  object_id INT(11) UNSIGNED,
  object_type CHAR(1) NOT NULL DEFAULT 'T',
  sort INT(11) UNSIGNED NOT NULL DEFAULT 1,
  extra TEXT,
  created DATETIME NOT NULL,
  updated DATETIME NOT NULL,
  PRIMARY KEY (id),
  KEY entry_lookup (object_type, object_id)
);

CREATE TABLE ost_form_entry_values (
  entry_id INT(11) UNSIGNED NOT NULL,
  field_id INT(11) UNSIGNED NOT NULL,
  value TEXT,
  value_id INT(11),
  PRIMARY KEY (entry_id, field_id)
);

CREATE TABLE ost_list (
  id INT(11) UNSIGNED NOT NULL AUTO_INCREMENT,
  name VARCHAR(255) NOT NULL,
  name_plural VARCHAR(255),
  sort_mode ENUM('Alpha','-Alpha','SortCol') NOT NULL DEFAULT 'Alpha',
  masks INT(11) UNSIGNED NOT NULL DEFAULT 0,
  type VARCHAR(16) NULL DEFAULT NULL,
  configuration TEXT NOT NULL DEFAULT '',
  notes TEXT,
  created DATETIME NOT NULL,
  updated DATETIME NOT NULL,
  PRIMARY KEY (id),
  KEY type (type)
);

CREATE TABLE ost_list_items (
  id INT(11) UNSIGNED NOT NULL AUTO_INCREMENT,
  list_id INT(11),
  status INT(11) UNSIGNED NOT NULL DEFAULT 1,
  value VARCHAR(255) NOT NULL,
  extra VARCHAR(255),
  sort INT(11) NOT NULL DEFAULT 1,
  properties TEXT,
  PRIMARY KEY (id),
  KEY list_item_lookup (list_id)
);

-- ============================================================
-- Filters & Routing
-- ============================================================

CREATE TABLE ost_filter (
  id INT(11) UNSIGNED NOT NULL AUTO_INCREMENT,
  execorder INT(10) UNSIGNED NOT NULL DEFAULT 99,
  isactive TINYINT(1) UNSIGNED NOT NULL DEFAULT 1,
  flags INT(10) UNSIGNED DEFAULT 0,
  status INT(11) UNSIGNED NOT NULL DEFAULT 0,
  match_all_rules TINYINT(1) UNSIGNED NOT NULL DEFAULT 0,
  stop_onmatch TINYINT(1) UNSIGNED NOT NULL DEFAULT 0,
  target ENUM('Any','Web','Email','API') NOT NULL DEFAULT 'Any',
  email_id INT(10) UNSIGNED NOT NULL DEFAULT 0,
  name VARCHAR(32) NOT NULL DEFAULT '',
  notes TEXT,
  created DATETIME NOT NULL,
  updated DATETIME NOT NULL,
  PRIMARY KEY (id),
  KEY target (target),
  KEY email_id (email_id)
);

CREATE TABLE ost_filter_rule (
  id INT(11) UNSIGNED NOT NULL AUTO_INCREMENT,
  filter_id INT(10) UNSIGNED NOT NULL DEFAULT 0,
  what VARCHAR(32) NOT NULL,
  how ENUM('equal','not_equal','contains','dn_contain','starts','ends','match','not_match') NOT NULL,
  val VARCHAR(255) NOT NULL,
  isactive TINYINT(1) UNSIGNED NOT NULL DEFAULT 1,
  notes TINYTEXT NOT NULL,
  created DATETIME NOT NULL,
  updated DATETIME NOT NULL,
  PRIMARY KEY (id),
  KEY filter_id (filter_id),
  UNIQUE KEY filter_rule (filter_id, what, how, val)
);

CREATE TABLE ost_filter_action (
  id INT(11) UNSIGNED NOT NULL AUTO_INCREMENT,
  filter_id INT(10) UNSIGNED NOT NULL,
  sort INT(10) UNSIGNED NOT NULL DEFAULT 0,
  type VARCHAR(24) NOT NULL,
  configuration TEXT,
  updated DATETIME NOT NULL,
  PRIMARY KEY (id),
  KEY filter_id (filter_id)
);

-- ============================================================
-- SLA & Schedules
-- ============================================================

CREATE TABLE ost_sla (
  id INT(11) UNSIGNED NOT NULL AUTO_INCREMENT,
  schedule_id INT(10) UNSIGNED NOT NULL DEFAULT 0,
  flags INT(10) UNSIGNED NOT NULL DEFAULT 3,
  grace_period INT(10) UNSIGNED NOT NULL DEFAULT 0,
  name VARCHAR(64) NOT NULL DEFAULT '',
  notes TEXT,
  created DATETIME NOT NULL,
  updated DATETIME NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY name (name)
);

CREATE TABLE ost_schedule (
  id INT(11) UNSIGNED NOT NULL AUTO_INCREMENT,
  flags INT(11) UNSIGNED NOT NULL DEFAULT 0,
  name VARCHAR(255) NOT NULL,
  timezone VARCHAR(64) DEFAULT NULL,
  description VARCHAR(255) NOT NULL,
  created DATETIME NOT NULL,
  updated DATETIME NOT NULL,
  PRIMARY KEY (id)
);

CREATE TABLE ost_schedule_entry (
  id INT(11) UNSIGNED NOT NULL AUTO_INCREMENT,
  schedule_id INT(11) UNSIGNED NOT NULL DEFAULT 0,
  flags INT(11) UNSIGNED NOT NULL DEFAULT 0,
  sort TINYINT(3) UNSIGNED NOT NULL DEFAULT 0,
  name VARCHAR(255) NOT NULL,
  repeats VARCHAR(16) NOT NULL DEFAULT 'never',
  starts_on DATE DEFAULT NULL,
  starts_at TIME DEFAULT NULL,
  ends_on DATE DEFAULT NULL,
  ends_at TIME DEFAULT NULL,
  stops_on DATETIME DEFAULT NULL,
  day TINYINT(4) DEFAULT NULL,
  week TINYINT(4) DEFAULT NULL,
  month TINYINT(4) DEFAULT NULL,
  created DATETIME NOT NULL,
  updated DATETIME NOT NULL,
  PRIMARY KEY (id),
  KEY schedule_id (schedule_id),
  KEY repeats (repeats)
);

-- ============================================================
-- Files & Attachments
-- ============================================================

CREATE TABLE ost_file (
  id INT(11) NOT NULL AUTO_INCREMENT,
  ft CHAR(1) NOT NULL DEFAULT 'T',
  bk CHAR(1) NOT NULL DEFAULT 'D',
  type VARCHAR(255) COLLATE ascii_general_ci NOT NULL DEFAULT '',
  size BIGINT(20) UNSIGNED NOT NULL DEFAULT 0,
  `key` VARCHAR(86) COLLATE ascii_general_ci NOT NULL,
  signature VARCHAR(86) COLLATE ascii_bin NOT NULL,
  name VARCHAR(255) NOT NULL DEFAULT '',
  attrs VARCHAR(255),
  created DATETIME NOT NULL,
  PRIMARY KEY (id),
  KEY ft (ft),
  KEY `key` (`key`),
  KEY signature (signature),
  KEY type (type),
  KEY created (created),
  KEY size (size)
);

CREATE TABLE ost_file_chunk (
  file_id INT(11) NOT NULL,
  chunk_id INT(11) NOT NULL,
  filedata LONGBLOB NOT NULL,
  PRIMARY KEY (file_id, chunk_id)
);

CREATE TABLE ost_attachment (
  id INT(10) UNSIGNED NOT NULL AUTO_INCREMENT,
  object_id INT(11) UNSIGNED NOT NULL,
  type CHAR(1) NOT NULL,
  file_id INT(11) UNSIGNED NOT NULL,
  name VARCHAR(255) NULL DEFAULT NULL,
  `inline` TINYINT(1) UNSIGNED NOT NULL DEFAULT 0,
  lang VARCHAR(16),
  PRIMARY KEY (id),
  UNIQUE KEY file_type (object_id, file_id, type),
  UNIQUE KEY file_object (file_id, object_id)
);

-- ============================================================
-- Notes & Drafts
-- ============================================================

CREATE TABLE ost_note (
  id INT(11) UNSIGNED NOT NULL AUTO_INCREMENT,
  pid INT(11) UNSIGNED,
  staff_id INT(11) UNSIGNED NOT NULL DEFAULT 0,
  ext_id VARCHAR(10),
  body TEXT,
  status INT(11) UNSIGNED NOT NULL DEFAULT 0,
  sort INT(11) UNSIGNED NOT NULL DEFAULT 0,
  created TIMESTAMP NOT NULL DEFAULT '0000-00-00 00:00:00',
  updated TIMESTAMP NOT NULL DEFAULT '0000-00-00 00:00:00' ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY ext_id (ext_id)
);

CREATE TABLE ost_draft (
  id INT(11) UNSIGNED NOT NULL AUTO_INCREMENT,
  staff_id INT(11) UNSIGNED NOT NULL,
  namespace VARCHAR(32) NOT NULL DEFAULT '',
  body TEXT NOT NULL,
  extra TEXT,
  created TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated TIMESTAMP NULL DEFAULT NULL,
  PRIMARY KEY (id),
  KEY staff_id (staff_id),
  KEY namespace (namespace)
);

-- ============================================================
-- Queue Views & Sorting
-- ============================================================

CREATE TABLE ost_queue (
  id INT(11) UNSIGNED NOT NULL AUTO_INCREMENT,
  parent_id INT(11) UNSIGNED NOT NULL DEFAULT 0,
  columns_id INT(11) UNSIGNED DEFAULT NULL,
  sort_id INT(11) UNSIGNED DEFAULT NULL,
  flags INT(11) UNSIGNED NOT NULL DEFAULT 0,
  staff_id INT(11) UNSIGNED NOT NULL DEFAULT 0,
  sort INT(11) UNSIGNED NOT NULL DEFAULT 0,
  title VARCHAR(60),
  config TEXT,
  filter VARCHAR(64),
  root VARCHAR(32) DEFAULT NULL,
  path VARCHAR(80) NOT NULL DEFAULT '/',
  created DATETIME NOT NULL,
  updated DATETIME NOT NULL,
  PRIMARY KEY (id),
  KEY staff_id (staff_id),
  KEY parent_id (parent_id)
);

CREATE TABLE ost_queue_column (
  id INT(11) UNSIGNED NOT NULL AUTO_INCREMENT,
  flags INT(10) UNSIGNED NOT NULL DEFAULT 0,
  name VARCHAR(64) NOT NULL DEFAULT '',
  `primary` VARCHAR(64) NOT NULL DEFAULT '',
  secondary VARCHAR(64) DEFAULT NULL,
  filter VARCHAR(32) DEFAULT NULL,
  truncate VARCHAR(16) DEFAULT NULL,
  annotations TEXT,
  conditions TEXT,
  extra TEXT,
  PRIMARY KEY (id)
);

CREATE TABLE ost_queue_columns (
  queue_id INT(11) UNSIGNED NOT NULL,
  column_id INT(11) UNSIGNED NOT NULL,
  staff_id INT(11) UNSIGNED NOT NULL,
  bits INT(10) UNSIGNED NOT NULL DEFAULT 0,
  sort INT(10) UNSIGNED NOT NULL DEFAULT 1,
  heading VARCHAR(64) DEFAULT NULL,
  width INT(10) UNSIGNED NOT NULL DEFAULT 100,
  PRIMARY KEY (queue_id, column_id, staff_id)
);

CREATE TABLE ost_queue_sort (
  id INT(11) UNSIGNED NOT NULL AUTO_INCREMENT,
  root VARCHAR(32) DEFAULT NULL,
  name VARCHAR(64) NOT NULL DEFAULT '',
  columns TEXT,
  updated DATETIME DEFAULT NULL,
  PRIMARY KEY (id)
);

CREATE TABLE ost_queue_sorts (
  queue_id INT(11) UNSIGNED NOT NULL,
  sort_id INT(11) UNSIGNED NOT NULL,
  bits INT(11) UNSIGNED NOT NULL DEFAULT 0,
  sort INT(10) UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (queue_id, sort_id)
);

CREATE TABLE ost_queue_export (
  id INT(11) UNSIGNED NOT NULL AUTO_INCREMENT,
  queue_id INT(11) UNSIGNED NOT NULL,
  path VARCHAR(64) NOT NULL DEFAULT '',
  heading VARCHAR(64) DEFAULT NULL,
  sort INT(10) UNSIGNED NOT NULL DEFAULT 1,
  PRIMARY KEY (id),
  KEY queue_id (queue_id)
);

CREATE TABLE ost_queue_config (
  queue_id INT(11) UNSIGNED NOT NULL,
  staff_id INT(11) UNSIGNED NOT NULL,
  setting TEXT,
  updated DATETIME NOT NULL,
  PRIMARY KEY (queue_id, staff_id)
);

-- ============================================================
-- Plugins
-- ============================================================

CREATE TABLE ost_plugin (
  id INT(11) UNSIGNED NOT NULL AUTO_INCREMENT,
  name VARCHAR(255) NOT NULL,
  install_path VARCHAR(60) NOT NULL,
  isactive TINYINT(1) NOT NULL DEFAULT 0,
  version VARCHAR(64),
  notes TEXT DEFAULT NULL,
  installed DATETIME NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY install_path (install_path)
);

CREATE TABLE ost_plugin_instance (
  id INT(11) UNSIGNED NOT NULL AUTO_INCREMENT,
  plugin_id INT(11) UNSIGNED NOT NULL,
  flags INT(10) NOT NULL DEFAULT 0,
  name VARCHAR(255) NOT NULL DEFAULT '',
  notes TEXT DEFAULT NULL,
  created DATETIME NOT NULL,
  updated DATETIME DEFAULT NULL,
  PRIMARY KEY (id),
  KEY plugin_id (plugin_id)
);

-- ============================================================
-- Content & Internationalization
-- ============================================================

CREATE TABLE IF NOT EXISTS ost_content (
  id INT(10) UNSIGNED NOT NULL AUTO_INCREMENT,
  isactive TINYINT(1) UNSIGNED NOT NULL DEFAULT 0,
  type VARCHAR(32) NOT NULL DEFAULT 'other',
  name VARCHAR(255) NOT NULL,
  body TEXT NOT NULL,
  notes TEXT,
  created DATETIME NOT NULL,
  updated DATETIME NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY name (name)
);

CREATE TABLE ost_translation (
  id INT(11) UNSIGNED NOT NULL AUTO_INCREMENT,
  object_hash CHAR(16) CHARACTER SET ascii DEFAULT NULL,
  type ENUM('phrase','article','override') DEFAULT NULL,
  flags INT(10) UNSIGNED NOT NULL DEFAULT 0,
  revision INT(11) UNSIGNED DEFAULT NULL,
  agent_id INT(10) UNSIGNED NOT NULL DEFAULT 0,
  lang VARCHAR(16) NOT NULL DEFAULT '',
  text MEDIUMTEXT NOT NULL,
  source_text TEXT,
  updated TIMESTAMP NULL DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY type (type, lang),
  KEY object_hash (object_hash)
);
