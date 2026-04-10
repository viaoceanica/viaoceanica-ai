ALTER TABLE `modules` ADD `mountType` varchar(50) DEFAULT 'iframe';--> statement-breakpoint
ALTER TABLE `modules` ADD `backendUrl` varchar(500);--> statement-breakpoint
ALTER TABLE `modules` ADD `frontendUrl` varchar(500);--> statement-breakpoint
ALTER TABLE `modules` ADD `status` varchar(50) DEFAULT 'active';