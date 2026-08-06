


SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;


COMMENT ON SCHEMA "public" IS 'standard public schema';



CREATE EXTENSION IF NOT EXISTS "pg_stat_statements" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "pgcrypto" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "supabase_vault" WITH SCHEMA "vault";






CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA "extensions";






CREATE OR REPLACE FUNCTION "public"."handle_new_user"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
begin
  insert into public.profiles (id, full_name, avatar_url, role)
  values (
    new.id,
    new.raw_user_meta_data ->> 'full_name',
    new.raw_user_meta_data ->> 'avatar_url',
    coalesce(new.raw_user_meta_data ->> 'role', 'clipper')
  );
  return new;
end;
$$;


ALTER FUNCTION "public"."handle_new_user"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rls_auto_enable"() RETURNS "event_trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'pg_catalog'
    AS $$
DECLARE
  cmd record;
BEGIN
  FOR cmd IN
    SELECT *
    FROM pg_event_trigger_ddl_commands()
    WHERE command_tag IN ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
      AND object_type IN ('table','partitioned table')
  LOOP
     IF cmd.schema_name IS NOT NULL AND cmd.schema_name IN ('public') AND cmd.schema_name NOT IN ('pg_catalog','information_schema') AND cmd.schema_name NOT LIKE 'pg_toast%' AND cmd.schema_name NOT LIKE 'pg_temp%' THEN
      BEGIN
        EXECUTE format('alter table if exists %s enable row level security', cmd.object_identity);
        RAISE LOG 'rls_auto_enable: enabled RLS on %', cmd.object_identity;
      EXCEPTION
        WHEN OTHERS THEN
          RAISE LOG 'rls_auto_enable: failed to enable RLS on %', cmd.object_identity;
      END;
     ELSE
        RAISE LOG 'rls_auto_enable: skip % (either system schema or not in enforced list: %.)', cmd.object_identity, cmd.schema_name;
     END IF;
  END LOOP;
END;
$$;


ALTER FUNCTION "public"."rls_auto_enable"() OWNER TO "postgres";

SET default_tablespace = '';

SET default_table_access_method = "heap";


CREATE TABLE IF NOT EXISTS "public"."brand_profiles" (
    "user_id" "uuid" NOT NULL,
    "company_name" "text",
    "website" "text",
    "logo_url" "text",
    "industry" "text",
    "description" "text",
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."brand_profiles" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."campaign_applications" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "campaign_id" "uuid" NOT NULL,
    "clipper_id" "uuid" DEFAULT "auth"."uid"() NOT NULL,
    "status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "message" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "reviewed_at" timestamp with time zone,
    CONSTRAINT "campaign_applications_status_check" CHECK (("status" = ANY (ARRAY['pending'::"text", 'approved'::"text", 'rejected'::"text"])))
);


ALTER TABLE "public"."campaign_applications" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."campaign_payouts" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "application_id" "uuid" NOT NULL,
    "clipper_id" "uuid" NOT NULL,
    "amount" numeric NOT NULL,
    "razorpay_transfer_id" "text",
    "status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "held_at" timestamp with time zone,
    "released_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "campaign_payouts_status_check" CHECK (("status" = ANY (ARRAY['pending'::"text", 'held'::"text", 'released'::"text", 'failed'::"text"])))
);


ALTER TABLE "public"."campaign_payouts" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."campaign_submissions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "application_id" "uuid" NOT NULL,
    "clipper_id" "uuid" DEFAULT "auth"."uid"() NOT NULL,
    "video_url" "text" NOT NULL,
    "view_count_at_submission" bigint,
    "status" "text" DEFAULT 'submitted'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "campaign_submissions_status_check" CHECK (("status" = ANY (ARRAY['submitted'::"text", 'approved'::"text", 'rejected'::"text"])))
);


ALTER TABLE "public"."campaign_submissions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."campaigns" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "brand_id" "uuid" NOT NULL,
    "title" "text" NOT NULL,
    "description" "text",
    "requirements" "text",
    "platform" "text" DEFAULT 'youtube'::"text" NOT NULL,
    "payout_structure" "text" NOT NULL,
    "payout_rate" numeric NOT NULL,
    "budget" numeric,
    "deadline" "date",
    "status" "text" DEFAULT 'draft'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "razorpay_order_id" "text",
    "razorpay_payment_id" "text",
    "funding_status" "text" DEFAULT 'unfunded'::"text" NOT NULL,
    CONSTRAINT "campaigns_active_requires_funded" CHECK ((("status" <> 'active'::"text") OR ("funding_status" = 'paid'::"text"))),
    CONSTRAINT "campaigns_funding_status_check" CHECK (("funding_status" = ANY (ARRAY['unfunded'::"text", 'created'::"text", 'paid'::"text", 'failed'::"text"]))),
    CONSTRAINT "campaigns_payout_structure_check" CHECK (("payout_structure" = ANY (ARRAY['per_view'::"text", 'flat_fee'::"text"]))),
    CONSTRAINT "campaigns_platform_check" CHECK (("platform" = 'youtube'::"text")),
    CONSTRAINT "campaigns_status_check" CHECK (("status" = ANY (ARRAY['draft'::"text", 'active'::"text", 'completed'::"text", 'cancelled'::"text"])))
);


ALTER TABLE "public"."campaigns" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."clipper_payout_accounts" (
    "user_id" "uuid" NOT NULL,
    "razorpay_account_id" "text",
    "legal_business_name" "text",
    "contact_name" "text",
    "phone" "text",
    "pan" "text",
    "address_street1" "text",
    "address_city" "text",
    "address_state" "text",
    "address_postal_code" "text",
    "bank_account_number" "text",
    "bank_ifsc" "text",
    "status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "razorpay_product_id" "text",
    "activation_status" "text",
    CONSTRAINT "clipper_payout_accounts_status_check" CHECK (("status" = ANY (ARRAY['pending'::"text", 'active'::"text", 'failed'::"text", 'under_review'::"text"])))
);


ALTER TABLE "public"."clipper_payout_accounts" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."clipper_profiles" (
    "user_id" "uuid" NOT NULL,
    "bio" "text",
    "categories" "text"[],
    "style_tags" "text"[],
    "pricing_model" "text",
    "rate_amount" numeric,
    "availability_status" "text" DEFAULT 'available'::"text" NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "clipper_profiles_availability_status_check" CHECK (("availability_status" = ANY (ARRAY['available'::"text", 'busy'::"text", 'unavailable'::"text"]))),
    CONSTRAINT "clipper_profiles_pricing_model_check" CHECK (("pricing_model" = ANY (ARRAY['per_clip'::"text", 'cpm'::"text", 'flat_campaign'::"text"])))
);


ALTER TABLE "public"."clipper_profiles" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."profiles" (
    "id" "uuid" NOT NULL,
    "full_name" "text",
    "avatar_url" "text",
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "role" "text" DEFAULT 'clipper'::"text" NOT NULL,
    CONSTRAINT "profiles_role_check" CHECK (("role" = ANY (ARRAY['brand'::"text", 'clipper'::"text"])))
);


ALTER TABLE "public"."profiles" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."youtube_activities" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "activity_id" "text" NOT NULL,
    "type" "text",
    "title" "text",
    "description" "text",
    "thumbnail_url" "text",
    "video_id" "text",
    "published_at" timestamp with time zone
);


ALTER TABLE "public"."youtube_activities" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."youtube_channel_stats_daily" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "date" "date" NOT NULL,
    "views" bigint,
    "estimated_minutes_watched" bigint,
    "subscribers_gained" bigint,
    "likes" bigint,
    "comments" bigint,
    "shares" bigint
);


ALTER TABLE "public"."youtube_channel_stats_daily" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."youtube_connections" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "access_token" "text",
    "refresh_token" "text",
    "token_expires_at" timestamp with time zone,
    "channel_id" "text",
    "channel_title" "text",
    "channel_thumbnail_url" "text",
    "connected_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "last_synced_at" timestamp with time zone,
    "verification_method" "text",
    "verification_code" "text",
    "verified_at" timestamp with time zone,
    "payout_multiplier" numeric,
    "bio_code_confirmed_at" timestamp with time zone,
    CONSTRAINT "youtube_connections_verification_method_check" CHECK (("verification_method" = ANY (ARRAY['linked'::"text", 'bio_code'::"text"])))
);


ALTER TABLE "public"."youtube_connections" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."youtube_videos" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "video_id" "text" NOT NULL,
    "title" "text",
    "thumbnail_url" "text",
    "published_at" timestamp with time zone,
    "view_count" bigint,
    "like_count" bigint,
    "comment_count" bigint,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."youtube_videos" OWNER TO "postgres";


ALTER TABLE ONLY "public"."brand_profiles"
    ADD CONSTRAINT "brand_profiles_pkey" PRIMARY KEY ("user_id");



ALTER TABLE ONLY "public"."campaign_applications"
    ADD CONSTRAINT "campaign_applications_campaign_id_clipper_id_key" UNIQUE ("campaign_id", "clipper_id");



ALTER TABLE ONLY "public"."campaign_applications"
    ADD CONSTRAINT "campaign_applications_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."campaign_payouts"
    ADD CONSTRAINT "campaign_payouts_application_id_key" UNIQUE ("application_id");



ALTER TABLE ONLY "public"."campaign_payouts"
    ADD CONSTRAINT "campaign_payouts_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."campaign_submissions"
    ADD CONSTRAINT "campaign_submissions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."campaigns"
    ADD CONSTRAINT "campaigns_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."clipper_payout_accounts"
    ADD CONSTRAINT "clipper_payout_accounts_pkey" PRIMARY KEY ("user_id");



ALTER TABLE ONLY "public"."clipper_profiles"
    ADD CONSTRAINT "clipper_profiles_pkey" PRIMARY KEY ("user_id");



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."youtube_activities"
    ADD CONSTRAINT "youtube_activities_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."youtube_activities"
    ADD CONSTRAINT "youtube_activities_user_id_activity_id_key" UNIQUE ("user_id", "activity_id");



ALTER TABLE ONLY "public"."youtube_channel_stats_daily"
    ADD CONSTRAINT "youtube_channel_stats_daily_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."youtube_channel_stats_daily"
    ADD CONSTRAINT "youtube_channel_stats_daily_user_id_date_key" UNIQUE ("user_id", "date");



ALTER TABLE ONLY "public"."youtube_connections"
    ADD CONSTRAINT "youtube_connections_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."youtube_connections"
    ADD CONSTRAINT "youtube_connections_user_id_key" UNIQUE ("user_id");



ALTER TABLE ONLY "public"."youtube_videos"
    ADD CONSTRAINT "youtube_videos_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."youtube_videos"
    ADD CONSTRAINT "youtube_videos_user_id_video_id_key" UNIQUE ("user_id", "video_id");



CREATE INDEX "campaign_submissions_application_id_idx" ON "public"."campaign_submissions" USING "btree" ("application_id", "created_at" DESC);



ALTER TABLE ONLY "public"."brand_profiles"
    ADD CONSTRAINT "brand_profiles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."campaign_applications"
    ADD CONSTRAINT "campaign_applications_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."campaign_applications"
    ADD CONSTRAINT "campaign_applications_clipper_id_fkey" FOREIGN KEY ("clipper_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."campaign_payouts"
    ADD CONSTRAINT "campaign_payouts_application_id_fkey" FOREIGN KEY ("application_id") REFERENCES "public"."campaign_applications"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."campaign_payouts"
    ADD CONSTRAINT "campaign_payouts_clipper_id_fkey" FOREIGN KEY ("clipper_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."campaign_submissions"
    ADD CONSTRAINT "campaign_submissions_application_id_fkey" FOREIGN KEY ("application_id") REFERENCES "public"."campaign_applications"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."campaign_submissions"
    ADD CONSTRAINT "campaign_submissions_clipper_id_fkey" FOREIGN KEY ("clipper_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."campaigns"
    ADD CONSTRAINT "campaigns_brand_id_fkey" FOREIGN KEY ("brand_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."clipper_payout_accounts"
    ADD CONSTRAINT "clipper_payout_accounts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."clipper_profiles"
    ADD CONSTRAINT "clipper_profiles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_id_fkey" FOREIGN KEY ("id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."youtube_activities"
    ADD CONSTRAINT "youtube_activities_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."youtube_channel_stats_daily"
    ADD CONSTRAINT "youtube_channel_stats_daily_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."youtube_connections"
    ADD CONSTRAINT "youtube_connections_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."youtube_videos"
    ADD CONSTRAINT "youtube_videos_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



CREATE POLICY "Anyone can view brand profiles" ON "public"."brand_profiles" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "Authenticated users can view basic profile info" ON "public"."profiles" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "Brands can create own campaigns" ON "public"."campaigns" FOR INSERT TO "authenticated" WITH CHECK (((( SELECT "auth"."uid"() AS "uid") = "brand_id") AND (EXISTS ( SELECT 1
   FROM "public"."profiles"
  WHERE (("profiles"."id" = ( SELECT "auth"."uid"() AS "uid")) AND ("profiles"."role" = 'brand'::"text"))))));



CREATE POLICY "Brands can delete own campaigns" ON "public"."campaigns" FOR DELETE TO "authenticated" USING ((( SELECT "auth"."uid"() AS "uid") = "brand_id"));



CREATE POLICY "Brands can insert own brand profile" ON "public"."brand_profiles" FOR INSERT TO "authenticated" WITH CHECK ((( SELECT "auth"."uid"() AS "uid") = "user_id"));



CREATE POLICY "Brands can review applications to own campaigns" ON "public"."campaign_applications" FOR UPDATE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."campaigns" "c"
  WHERE (("c"."id" = "campaign_applications"."campaign_id") AND ("c"."brand_id" = ( SELECT "auth"."uid"() AS "uid")))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."campaigns" "c"
  WHERE (("c"."id" = "campaign_applications"."campaign_id") AND ("c"."brand_id" = ( SELECT "auth"."uid"() AS "uid"))))));



CREATE POLICY "Brands can review submissions to own campaigns" ON "public"."campaign_submissions" FOR UPDATE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM ("public"."campaign_applications" "a"
     JOIN "public"."campaigns" "c" ON (("c"."id" = "a"."campaign_id")))
  WHERE (("a"."id" = "campaign_submissions"."application_id") AND ("c"."brand_id" = ( SELECT "auth"."uid"() AS "uid")))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM ("public"."campaign_applications" "a"
     JOIN "public"."campaigns" "c" ON (("c"."id" = "a"."campaign_id")))
  WHERE (("a"."id" = "campaign_submissions"."application_id") AND ("c"."brand_id" = ( SELECT "auth"."uid"() AS "uid"))))));



CREATE POLICY "Brands can update own brand profile" ON "public"."brand_profiles" FOR UPDATE TO "authenticated" USING ((( SELECT "auth"."uid"() AS "uid") = "user_id")) WITH CHECK ((( SELECT "auth"."uid"() AS "uid") = "user_id"));



CREATE POLICY "Brands can update own campaigns" ON "public"."campaigns" FOR UPDATE TO "authenticated" USING ((( SELECT "auth"."uid"() AS "uid") = "brand_id")) WITH CHECK ((( SELECT "auth"."uid"() AS "uid") = "brand_id"));



CREATE POLICY "Brands can view all clipper profiles" ON "public"."clipper_profiles" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."profiles"
  WHERE (("profiles"."id" = ( SELECT "auth"."uid"() AS "uid")) AND ("profiles"."role" = 'brand'::"text")))));



CREATE POLICY "Brands can view applications to own campaigns" ON "public"."campaign_applications" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."campaigns" "c"
  WHERE (("c"."id" = "campaign_applications"."campaign_id") AND ("c"."brand_id" = ( SELECT "auth"."uid"() AS "uid"))))));



CREATE POLICY "Brands can view own campaigns" ON "public"."campaigns" FOR SELECT TO "authenticated" USING ((( SELECT "auth"."uid"() AS "uid") = "brand_id"));



CREATE POLICY "Brands can view payouts for own campaigns" ON "public"."campaign_payouts" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM ("public"."campaign_applications" "a"
     JOIN "public"."campaigns" "c" ON (("c"."id" = "a"."campaign_id")))
  WHERE (("a"."id" = "campaign_payouts"."application_id") AND ("c"."brand_id" = ( SELECT "auth"."uid"() AS "uid"))))));



CREATE POLICY "Brands can view submissions to own campaigns" ON "public"."campaign_submissions" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM ("public"."campaign_applications" "a"
     JOIN "public"."campaigns" "c" ON (("c"."id" = "a"."campaign_id")))
  WHERE (("a"."id" = "campaign_submissions"."application_id") AND ("c"."brand_id" = ( SELECT "auth"."uid"() AS "uid"))))));



CREATE POLICY "Clippers can apply to funded active campaigns" ON "public"."campaign_applications" FOR INSERT TO "authenticated" WITH CHECK (((( SELECT "auth"."uid"() AS "uid") = "clipper_id") AND (EXISTS ( SELECT 1
   FROM "public"."profiles"
  WHERE (("profiles"."id" = ( SELECT "auth"."uid"() AS "uid")) AND ("profiles"."role" = 'clipper'::"text")))) AND (EXISTS ( SELECT 1
   FROM "public"."campaigns" "c"
  WHERE (("c"."id" = "campaign_applications"."campaign_id") AND ("c"."status" = 'active'::"text") AND ("c"."funding_status" = 'paid'::"text"))))));



CREATE POLICY "Clippers can insert own clipper profile" ON "public"."clipper_profiles" FOR INSERT TO "authenticated" WITH CHECK ((( SELECT "auth"."uid"() AS "uid") = "user_id"));



CREATE POLICY "Clippers can insert own payout account" ON "public"."clipper_payout_accounts" FOR INSERT TO "authenticated" WITH CHECK ((( SELECT "auth"."uid"() AS "uid") = "user_id"));



CREATE POLICY "Clippers can submit to own approved applications" ON "public"."campaign_submissions" FOR INSERT TO "authenticated" WITH CHECK (((( SELECT "auth"."uid"() AS "uid") = "clipper_id") AND (EXISTS ( SELECT 1
   FROM "public"."profiles"
  WHERE (("profiles"."id" = ( SELECT "auth"."uid"() AS "uid")) AND ("profiles"."role" = 'clipper'::"text")))) AND (EXISTS ( SELECT 1
   FROM "public"."campaign_applications" "a"
  WHERE (("a"."id" = "campaign_submissions"."application_id") AND ("a"."clipper_id" = ( SELECT "auth"."uid"() AS "uid")) AND ("a"."status" = 'approved'::"text"))))));



CREATE POLICY "Clippers can update own clipper profile" ON "public"."clipper_profiles" FOR UPDATE TO "authenticated" USING ((( SELECT "auth"."uid"() AS "uid") = "user_id")) WITH CHECK ((( SELECT "auth"."uid"() AS "uid") = "user_id"));



CREATE POLICY "Clippers can update own payout account" ON "public"."clipper_payout_accounts" FOR UPDATE TO "authenticated" USING ((( SELECT "auth"."uid"() AS "uid") = "user_id")) WITH CHECK ((( SELECT "auth"."uid"() AS "uid") = "user_id"));



CREATE POLICY "Clippers can view campaigns they applied to" ON "public"."campaigns" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."campaign_applications" "a"
  WHERE (("a"."campaign_id" = "a"."id") AND ("a"."clipper_id" = ( SELECT "auth"."uid"() AS "uid"))))));



CREATE POLICY "Clippers can view funded active campaigns" ON "public"."campaigns" FOR SELECT TO "authenticated" USING ((("status" = 'active'::"text") AND ("funding_status" = 'paid'::"text")));



CREATE POLICY "Clippers can view own applications" ON "public"."campaign_applications" FOR SELECT TO "authenticated" USING ((( SELECT "auth"."uid"() AS "uid") = "clipper_id"));



CREATE POLICY "Clippers can view own clipper profile" ON "public"."clipper_profiles" FOR SELECT TO "authenticated" USING ((( SELECT "auth"."uid"() AS "uid") = "user_id"));



CREATE POLICY "Clippers can view own payout account" ON "public"."clipper_payout_accounts" FOR SELECT TO "authenticated" USING ((( SELECT "auth"."uid"() AS "uid") = "user_id"));



CREATE POLICY "Clippers can view own payouts" ON "public"."campaign_payouts" FOR SELECT TO "authenticated" USING ((( SELECT "auth"."uid"() AS "uid") = "clipper_id"));



CREATE POLICY "Clippers can view own submissions" ON "public"."campaign_submissions" FOR SELECT TO "authenticated" USING ((( SELECT "auth"."uid"() AS "uid") = "clipper_id"));



CREATE POLICY "Users can delete own youtube connection" ON "public"."youtube_connections" FOR DELETE TO "authenticated" USING ((( SELECT "auth"."uid"() AS "uid") = "user_id"));



CREATE POLICY "Users can insert own profile" ON "public"."profiles" FOR INSERT TO "authenticated" WITH CHECK ((( SELECT "auth"."uid"() AS "uid") = "id"));



CREATE POLICY "Users can insert own youtube activity" ON "public"."youtube_activities" FOR INSERT TO "authenticated" WITH CHECK ((( SELECT "auth"."uid"() AS "uid") = "user_id"));



CREATE POLICY "Users can insert own youtube connection" ON "public"."youtube_connections" FOR INSERT TO "authenticated" WITH CHECK ((( SELECT "auth"."uid"() AS "uid") = "user_id"));



CREATE POLICY "Users can insert own youtube stats" ON "public"."youtube_channel_stats_daily" FOR INSERT TO "authenticated" WITH CHECK ((( SELECT "auth"."uid"() AS "uid") = "user_id"));



CREATE POLICY "Users can insert own youtube videos" ON "public"."youtube_videos" FOR INSERT TO "authenticated" WITH CHECK ((( SELECT "auth"."uid"() AS "uid") = "user_id"));



CREATE POLICY "Users can update own profile" ON "public"."profiles" FOR UPDATE TO "authenticated" USING ((( SELECT "auth"."uid"() AS "uid") = "id")) WITH CHECK ((( SELECT "auth"."uid"() AS "uid") = "id"));



CREATE POLICY "Users can update own youtube activity" ON "public"."youtube_activities" FOR UPDATE TO "authenticated" USING ((( SELECT "auth"."uid"() AS "uid") = "user_id")) WITH CHECK ((( SELECT "auth"."uid"() AS "uid") = "user_id"));



CREATE POLICY "Users can update own youtube connection" ON "public"."youtube_connections" FOR UPDATE TO "authenticated" USING ((( SELECT "auth"."uid"() AS "uid") = "user_id")) WITH CHECK ((( SELECT "auth"."uid"() AS "uid") = "user_id"));



CREATE POLICY "Users can update own youtube stats" ON "public"."youtube_channel_stats_daily" FOR UPDATE TO "authenticated" USING ((( SELECT "auth"."uid"() AS "uid") = "user_id")) WITH CHECK ((( SELECT "auth"."uid"() AS "uid") = "user_id"));



CREATE POLICY "Users can update own youtube videos" ON "public"."youtube_videos" FOR UPDATE TO "authenticated" USING ((( SELECT "auth"."uid"() AS "uid") = "user_id")) WITH CHECK ((( SELECT "auth"."uid"() AS "uid") = "user_id"));



CREATE POLICY "Users can view own profile" ON "public"."profiles" FOR SELECT TO "authenticated" USING ((( SELECT "auth"."uid"() AS "uid") = "id"));



CREATE POLICY "Users can view own youtube activity" ON "public"."youtube_activities" FOR SELECT TO "authenticated" USING ((( SELECT "auth"."uid"() AS "uid") = "user_id"));



CREATE POLICY "Users can view own youtube connection" ON "public"."youtube_connections" FOR SELECT TO "authenticated" USING ((( SELECT "auth"."uid"() AS "uid") = "user_id"));



CREATE POLICY "Users can view own youtube stats" ON "public"."youtube_channel_stats_daily" FOR SELECT TO "authenticated" USING ((( SELECT "auth"."uid"() AS "uid") = "user_id"));



CREATE POLICY "Users can view own youtube videos" ON "public"."youtube_videos" FOR SELECT TO "authenticated" USING ((( SELECT "auth"."uid"() AS "uid") = "user_id"));



ALTER TABLE "public"."brand_profiles" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."campaign_applications" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."campaign_payouts" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."campaign_submissions" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."campaigns" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."clipper_payout_accounts" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."clipper_profiles" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."profiles" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."youtube_activities" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."youtube_channel_stats_daily" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."youtube_connections" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."youtube_videos" ENABLE ROW LEVEL SECURITY;




ALTER PUBLICATION "supabase_realtime" OWNER TO "postgres";


GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";






















































































































































GRANT ALL ON FUNCTION "public"."handle_new_user"() TO "anon";
GRANT ALL ON FUNCTION "public"."handle_new_user"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."handle_new_user"() TO "service_role";



GRANT ALL ON FUNCTION "public"."rls_auto_enable"() TO "anon";
GRANT ALL ON FUNCTION "public"."rls_auto_enable"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."rls_auto_enable"() TO "service_role";


















GRANT ALL ON TABLE "public"."brand_profiles" TO "anon";
GRANT ALL ON TABLE "public"."brand_profiles" TO "authenticated";
GRANT ALL ON TABLE "public"."brand_profiles" TO "service_role";



GRANT ALL ON TABLE "public"."campaign_applications" TO "anon";
GRANT ALL ON TABLE "public"."campaign_applications" TO "authenticated";
GRANT ALL ON TABLE "public"."campaign_applications" TO "service_role";



GRANT ALL ON TABLE "public"."campaign_payouts" TO "anon";
GRANT ALL ON TABLE "public"."campaign_payouts" TO "authenticated";
GRANT ALL ON TABLE "public"."campaign_payouts" TO "service_role";



GRANT ALL ON TABLE "public"."campaign_submissions" TO "anon";
GRANT ALL ON TABLE "public"."campaign_submissions" TO "authenticated";
GRANT ALL ON TABLE "public"."campaign_submissions" TO "service_role";



GRANT ALL ON TABLE "public"."campaigns" TO "anon";
GRANT ALL ON TABLE "public"."campaigns" TO "authenticated";
GRANT ALL ON TABLE "public"."campaigns" TO "service_role";



GRANT ALL ON TABLE "public"."clipper_payout_accounts" TO "anon";
GRANT ALL ON TABLE "public"."clipper_payout_accounts" TO "authenticated";
GRANT ALL ON TABLE "public"."clipper_payout_accounts" TO "service_role";



GRANT ALL ON TABLE "public"."clipper_profiles" TO "anon";
GRANT ALL ON TABLE "public"."clipper_profiles" TO "authenticated";
GRANT ALL ON TABLE "public"."clipper_profiles" TO "service_role";



GRANT ALL ON TABLE "public"."profiles" TO "anon";
GRANT ALL ON TABLE "public"."profiles" TO "authenticated";
GRANT ALL ON TABLE "public"."profiles" TO "service_role";



GRANT ALL ON TABLE "public"."youtube_activities" TO "anon";
GRANT ALL ON TABLE "public"."youtube_activities" TO "authenticated";
GRANT ALL ON TABLE "public"."youtube_activities" TO "service_role";



GRANT ALL ON TABLE "public"."youtube_channel_stats_daily" TO "anon";
GRANT ALL ON TABLE "public"."youtube_channel_stats_daily" TO "authenticated";
GRANT ALL ON TABLE "public"."youtube_channel_stats_daily" TO "service_role";



GRANT ALL ON TABLE "public"."youtube_connections" TO "anon";
GRANT ALL ON TABLE "public"."youtube_connections" TO "authenticated";
GRANT ALL ON TABLE "public"."youtube_connections" TO "service_role";



GRANT ALL ON TABLE "public"."youtube_videos" TO "anon";
GRANT ALL ON TABLE "public"."youtube_videos" TO "authenticated";
GRANT ALL ON TABLE "public"."youtube_videos" TO "service_role";









ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "service_role";



































