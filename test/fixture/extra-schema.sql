-- Extra tables / indexes required by Nodeticket create kernel but not always in docs/mysql.sql

CREATE TABLE IF NOT EXISTS ost_ticket__cdata (
  ticket_id INT(11) UNSIGNED NOT NULL,
  subject VARCHAR(255) DEFAULT NULL,
  PRIMARY KEY (ticket_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
