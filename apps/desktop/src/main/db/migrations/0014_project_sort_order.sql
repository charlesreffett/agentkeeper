ALTER TABLE `projects` ADD `sort_order` integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
UPDATE `projects`
SET `sort_order` = (
  SELECT COUNT(*)
  FROM `projects` AS `older`
  WHERE `older`.`last_opened_at` < `projects`.`last_opened_at`
     OR (`older`.`last_opened_at` = `projects`.`last_opened_at` AND `older`.`path` < `projects`.`path`)
);
