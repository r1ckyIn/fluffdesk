CREATE TABLE "bookings" (
	"id" text PRIMARY KEY NOT NULL,
	"shop_slug" text NOT NULL,
	"conversation_id" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"customer_name" text NOT NULL,
	"customer_contact" text NOT NULL,
	"channel" text NOT NULL,
	"pet" jsonb NOT NULL,
	"service_id" text NOT NULL,
	"start" text NOT NULL,
	"duration_min" integer NOT NULL,
	"quote" jsonb,
	"decided_at" timestamp with time zone,
	"decided_by" text,
	"decline_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "conversation_images" (
	"conversation_id" text NOT NULL,
	"image_id" text NOT NULL,
	"mime_type" text NOT NULL,
	"data" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "conversation_images_conversation_id_image_id_pk" PRIMARY KEY("conversation_id","image_id")
);
--> statement-breakpoint
CREATE TABLE "conversations" (
	"id" text PRIMARY KEY NOT NULL,
	"shop_slug" text NOT NULL,
	"channel" text NOT NULL,
	"external_id" text NOT NULL,
	"locale" text DEFAULT 'en' NOT NULL,
	"messages" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "corrections" (
	"id" text PRIMARY KEY NOT NULL,
	"shop_slug" text NOT NULL,
	"conversation_id" text NOT NULL,
	"trace_id" text,
	"kind" text NOT NULL,
	"original" jsonb,
	"corrected" jsonb,
	"note" text,
	"corrected_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "shops" (
	"slug" text PRIMARY KEY NOT NULL,
	"config" jsonb NOT NULL,
	"approved" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "traces" (
	"id" text PRIMARY KEY NOT NULL,
	"conversation_id" text NOT NULL,
	"shop_slug" text,
	"trace" jsonb NOT NULL,
	"cost_usd" numeric DEFAULT '0' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_shop_slug_shops_slug_fk" FOREIGN KEY ("shop_slug") REFERENCES "public"."shops"("slug") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_images" ADD CONSTRAINT "conversation_images_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_shop_slug_shops_slug_fk" FOREIGN KEY ("shop_slug") REFERENCES "public"."shops"("slug") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "corrections" ADD CONSTRAINT "corrections_shop_slug_shops_slug_fk" FOREIGN KEY ("shop_slug") REFERENCES "public"."shops"("slug") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "traces" ADD CONSTRAINT "traces_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "traces" ADD CONSTRAINT "traces_shop_slug_shops_slug_fk" FOREIGN KEY ("shop_slug") REFERENCES "public"."shops"("slug") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "bookings_shop_status" ON "bookings" USING btree ("shop_slug","status");--> statement-breakpoint
CREATE INDEX "bookings_conversation_status" ON "bookings" USING btree ("conversation_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "conversations_shop_channel_ext" ON "conversations" USING btree ("shop_slug","channel","external_id");