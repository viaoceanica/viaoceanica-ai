CREATE TABLE `module_permissions` (
	`id` int AUTO_INCREMENT NOT NULL,
	`companyModuleId` int NOT NULL,
	`teamId` int,
	`userId` int,
	`grantedAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `module_permissions_id` PRIMARY KEY(`id`)
);
