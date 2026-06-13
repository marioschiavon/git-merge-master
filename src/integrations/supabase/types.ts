export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      bookings: {
        Row: {
          attendees: Json | null
          calcom_booking_id: number | null
          calcom_booking_uid: string | null
          calcom_event_type_id: number | null
          calcom_reschedule_uid: string | null
          cancel_reason: string | null
          company_id: string
          conversation_id: string | null
          created_at: string
          duration_minutes: number | null
          end_at: string | null
          id: string
          lead_id: string | null
          location: string | null
          meeting_url: string | null
          owner_user_id: string | null
          previous_booking_id: string | null
          raw_payload: Json | null
          reschedule_reason: string | null
          scheduled_at: string | null
          status: Database["public"]["Enums"]["booking_status"]
          timezone: string | null
          title: string | null
          updated_at: string
        }
        Insert: {
          attendees?: Json | null
          calcom_booking_id?: number | null
          calcom_booking_uid?: string | null
          calcom_event_type_id?: number | null
          calcom_reschedule_uid?: string | null
          cancel_reason?: string | null
          company_id: string
          conversation_id?: string | null
          created_at?: string
          duration_minutes?: number | null
          end_at?: string | null
          id?: string
          lead_id?: string | null
          location?: string | null
          meeting_url?: string | null
          owner_user_id?: string | null
          previous_booking_id?: string | null
          raw_payload?: Json | null
          reschedule_reason?: string | null
          scheduled_at?: string | null
          status?: Database["public"]["Enums"]["booking_status"]
          timezone?: string | null
          title?: string | null
          updated_at?: string
        }
        Update: {
          attendees?: Json | null
          calcom_booking_id?: number | null
          calcom_booking_uid?: string | null
          calcom_event_type_id?: number | null
          calcom_reschedule_uid?: string | null
          cancel_reason?: string | null
          company_id?: string
          conversation_id?: string | null
          created_at?: string
          duration_minutes?: number | null
          end_at?: string | null
          id?: string
          lead_id?: string | null
          location?: string | null
          meeting_url?: string | null
          owner_user_id?: string | null
          previous_booking_id?: string | null
          raw_payload?: Json | null
          reschedule_reason?: string | null
          scheduled_at?: string | null
          status?: Database["public"]["Enums"]["booking_status"]
          timezone?: string | null
          title?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "bookings_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bookings_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bookings_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bookings_previous_booking_id_fkey"
            columns: ["previous_booking_id"]
            isOneToOne: false
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
        ]
      }
      cadence_agent_decisions: {
        Row: {
          action: string
          attempt_number: number
          channel: string | null
          company_id: string
          decided_at: string
          enrollment_id: string
          hook: string | null
          id: string
          message_body: string | null
          message_subject: string | null
          model: string | null
          rationale: string | null
          scheduled_for: string | null
          simulated: boolean
          stop_reason: string | null
          tokens_used: number | null
        }
        Insert: {
          action: string
          attempt_number?: number
          channel?: string | null
          company_id: string
          decided_at?: string
          enrollment_id: string
          hook?: string | null
          id?: string
          message_body?: string | null
          message_subject?: string | null
          model?: string | null
          rationale?: string | null
          scheduled_for?: string | null
          simulated?: boolean
          stop_reason?: string | null
          tokens_used?: number | null
        }
        Update: {
          action?: string
          attempt_number?: number
          channel?: string | null
          company_id?: string
          decided_at?: string
          enrollment_id?: string
          hook?: string | null
          id?: string
          message_body?: string | null
          message_subject?: string | null
          model?: string | null
          rationale?: string | null
          scheduled_for?: string | null
          simulated?: boolean
          stop_reason?: string | null
          tokens_used?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "cadence_agent_decisions_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cadence_agent_decisions_enrollment_id_fkey"
            columns: ["enrollment_id"]
            isOneToOne: false
            referencedRelation: "cadence_enrollments"
            referencedColumns: ["id"]
          },
        ]
      }
      cadence_custom_messages: {
        Row: {
          company_id: string
          created_at: string
          enrollment_id: string
          id: string
          lead_id: string
          message: string
          step_id: string
          subject: string | null
          updated_at: string
        }
        Insert: {
          company_id: string
          created_at?: string
          enrollment_id: string
          id?: string
          lead_id: string
          message: string
          step_id: string
          subject?: string | null
          updated_at?: string
        }
        Update: {
          company_id?: string
          created_at?: string
          enrollment_id?: string
          id?: string
          lead_id?: string
          message?: string
          step_id?: string
          subject?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "cadence_custom_messages_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cadence_custom_messages_enrollment_id_fkey"
            columns: ["enrollment_id"]
            isOneToOne: false
            referencedRelation: "cadence_enrollments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cadence_custom_messages_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cadence_custom_messages_step_id_fkey"
            columns: ["step_id"]
            isOneToOne: false
            referencedRelation: "cadence_steps"
            referencedColumns: ["id"]
          },
        ]
      }
      cadence_enrollments: {
        Row: {
          cadence_id: string
          company_id: string
          completed_at: string | null
          current_step: number
          enrolled_at: string
          id: string
          last_executed_at: string | null
          lead_id: string
          meeting_scheduled: boolean
          next_execution_at: string | null
          paused_reason: string | null
          status: Database["public"]["Enums"]["enrollment_status"]
          updated_at: string
        }
        Insert: {
          cadence_id: string
          company_id: string
          completed_at?: string | null
          current_step?: number
          enrolled_at?: string
          id?: string
          last_executed_at?: string | null
          lead_id: string
          meeting_scheduled?: boolean
          next_execution_at?: string | null
          paused_reason?: string | null
          status?: Database["public"]["Enums"]["enrollment_status"]
          updated_at?: string
        }
        Update: {
          cadence_id?: string
          company_id?: string
          completed_at?: string | null
          current_step?: number
          enrolled_at?: string
          id?: string
          last_executed_at?: string | null
          lead_id?: string
          meeting_scheduled?: boolean
          next_execution_at?: string | null
          paused_reason?: string | null
          status?: Database["public"]["Enums"]["enrollment_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "cadence_enrollments_cadence_id_fkey"
            columns: ["cadence_id"]
            isOneToOne: false
            referencedRelation: "cadences"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cadence_enrollments_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cadence_enrollments_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
        ]
      }
      cadence_policies: {
        Row: {
          allowed_channels: string[]
          business_hours: Json
          cadence_id: string
          company_id: string
          continue_criteria: string | null
          created_at: string
          goal: string
          max_attempts: number
          max_days: number
          min_fit_score: number | null
          primary_channel: string
          stop_criteria_flags: Json
          stop_criteria_text: string | null
          tone_instructions: string
          updated_at: string
        }
        Insert: {
          allowed_channels?: string[]
          business_hours?: Json
          cadence_id: string
          company_id: string
          continue_criteria?: string | null
          created_at?: string
          goal?: string
          max_attempts?: number
          max_days?: number
          min_fit_score?: number | null
          primary_channel?: string
          stop_criteria_flags?: Json
          stop_criteria_text?: string | null
          tone_instructions?: string
          updated_at?: string
        }
        Update: {
          allowed_channels?: string[]
          business_hours?: Json
          cadence_id?: string
          company_id?: string
          continue_criteria?: string | null
          created_at?: string
          goal?: string
          max_attempts?: number
          max_days?: number
          min_fit_score?: number | null
          primary_channel?: string
          stop_criteria_flags?: Json
          stop_criteria_text?: string | null
          tone_instructions?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "cadence_policies_cadence_id_fkey"
            columns: ["cadence_id"]
            isOneToOne: true
            referencedRelation: "cadences"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cadence_policies_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      cadence_steps: {
        Row: {
          cadence_id: string
          channel: Database["public"]["Enums"]["cadence_type"]
          created_at: string
          delay_days: number
          id: string
          mental_triggers: string[] | null
          smart_customization: boolean
          step_order: number
          subject: string | null
          template: string
          updated_at: string
          use_highlights: boolean
          use_mental_triggers: boolean
        }
        Insert: {
          cadence_id: string
          channel?: Database["public"]["Enums"]["cadence_type"]
          created_at?: string
          delay_days?: number
          id?: string
          mental_triggers?: string[] | null
          smart_customization?: boolean
          step_order?: number
          subject?: string | null
          template?: string
          updated_at?: string
          use_highlights?: boolean
          use_mental_triggers?: boolean
        }
        Update: {
          cadence_id?: string
          channel?: Database["public"]["Enums"]["cadence_type"]
          created_at?: string
          delay_days?: number
          id?: string
          mental_triggers?: string[] | null
          smart_customization?: boolean
          step_order?: number
          subject?: string | null
          template?: string
          updated_at?: string
          use_highlights?: boolean
          use_mental_triggers?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "cadence_steps_cadence_id_fkey"
            columns: ["cadence_id"]
            isOneToOne: false
            referencedRelation: "cadences"
            referencedColumns: ["id"]
          },
        ]
      }
      cadences: {
        Row: {
          company_id: string
          created_at: string
          created_by: string
          description: string | null
          id: string
          mode: string
          name: string
          simulation_mode: boolean
          status: Database["public"]["Enums"]["cadence_status"]
          type: Database["public"]["Enums"]["cadence_type"]
          updated_at: string
        }
        Insert: {
          company_id: string
          created_at?: string
          created_by: string
          description?: string | null
          id?: string
          mode?: string
          name: string
          simulation_mode?: boolean
          status?: Database["public"]["Enums"]["cadence_status"]
          type?: Database["public"]["Enums"]["cadence_type"]
          updated_at?: string
        }
        Update: {
          company_id?: string
          created_at?: string
          created_by?: string
          description?: string | null
          id?: string
          mode?: string
          name?: string
          simulation_mode?: boolean
          status?: Database["public"]["Enums"]["cadence_status"]
          type?: Database["public"]["Enums"]["cadence_type"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "cadences_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      calcom_event_types: {
        Row: {
          active: boolean
          calcom_id: number
          company_id: string
          created_at: string
          default_for_intent: string | null
          description: string | null
          id: string
          length_minutes: number | null
          raw: Json | null
          slug: string | null
          synced_at: string
          team_id: number | null
          title: string
          updated_at: string
        }
        Insert: {
          active?: boolean
          calcom_id: number
          company_id: string
          created_at?: string
          default_for_intent?: string | null
          description?: string | null
          id?: string
          length_minutes?: number | null
          raw?: Json | null
          slug?: string | null
          synced_at?: string
          team_id?: number | null
          title: string
          updated_at?: string
        }
        Update: {
          active?: boolean
          calcom_id?: number
          company_id?: string
          created_at?: string
          default_for_intent?: string | null
          description?: string | null
          id?: string
          length_minutes?: number | null
          raw?: Json | null
          slug?: string | null
          synced_at?: string
          team_id?: number | null
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "calcom_event_types_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      calcom_webhook_log: {
        Row: {
          booking_uid: string | null
          company_id: string | null
          created_at: string
          error: string | null
          event_type: string
          id: string
          payload: Json
          processed: boolean
          processed_at: string | null
          signature_valid: boolean | null
        }
        Insert: {
          booking_uid?: string | null
          company_id?: string | null
          created_at?: string
          error?: string | null
          event_type: string
          id?: string
          payload: Json
          processed?: boolean
          processed_at?: string | null
          signature_valid?: boolean | null
        }
        Update: {
          booking_uid?: string | null
          company_id?: string | null
          created_at?: string
          error?: string | null
          event_type?: string
          id?: string
          payload?: Json
          processed?: boolean
          processed_at?: string | null
          signature_valid?: boolean | null
        }
        Relationships: [
          {
            foreignKeyName: "calcom_webhook_log_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      companies: {
        Row: {
          calcom_default_event_type_id: number | null
          calcom_round_robin_enabled: boolean
          calcom_team_id: number | null
          created_at: string
          enrichment_settings: Json
          id: string
          logo_url: string | null
          max_leads: number
          max_users: number
          name: string
          slug: string
          status: Database["public"]["Enums"]["company_status"]
          updated_at: string
        }
        Insert: {
          calcom_default_event_type_id?: number | null
          calcom_round_robin_enabled?: boolean
          calcom_team_id?: number | null
          created_at?: string
          enrichment_settings?: Json
          id?: string
          logo_url?: string | null
          max_leads?: number
          max_users?: number
          name: string
          slug: string
          status?: Database["public"]["Enums"]["company_status"]
          updated_at?: string
        }
        Update: {
          calcom_default_event_type_id?: number | null
          calcom_round_robin_enabled?: boolean
          calcom_team_id?: number | null
          created_at?: string
          enrichment_settings?: Json
          id?: string
          logo_url?: string | null
          max_leads?: number
          max_users?: number
          name?: string
          slug?: string
          status?: Database["public"]["Enums"]["company_status"]
          updated_at?: string
        }
        Relationships: []
      }
      company_knowledge: {
        Row: {
          company_id: string
          content: string
          created_at: string
          embedded_at: string | null
          file_path: string | null
          id: string
          needs_embedding: boolean
          source_url: string | null
          title: string
          type: string
          updated_at: string
        }
        Insert: {
          company_id: string
          content?: string
          created_at?: string
          embedded_at?: string | null
          file_path?: string | null
          id?: string
          needs_embedding?: boolean
          source_url?: string | null
          title: string
          type?: string
          updated_at?: string
        }
        Update: {
          company_id?: string
          content?: string
          created_at?: string
          embedded_at?: string | null
          file_path?: string | null
          id?: string
          needs_embedding?: boolean
          source_url?: string | null
          title?: string
          type?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "company_knowledge_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      company_members: {
        Row: {
          company_id: string
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          company_id: string
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          company_id?: string
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "company_members_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      conversations: {
        Row: {
          cadence_enrollment_id: string | null
          channel: Database["public"]["Enums"]["cadence_type"]
          company_id: string
          created_at: string
          id: string
          lead_id: string
          summary: string | null
          summary_message_count: number
          summary_updated_at: string | null
        }
        Insert: {
          cadence_enrollment_id?: string | null
          channel?: Database["public"]["Enums"]["cadence_type"]
          company_id: string
          created_at?: string
          id?: string
          lead_id: string
          summary?: string | null
          summary_message_count?: number
          summary_updated_at?: string | null
        }
        Update: {
          cadence_enrollment_id?: string | null
          channel?: Database["public"]["Enums"]["cadence_type"]
          company_id?: string
          created_at?: string
          id?: string
          lead_id?: string
          summary?: string | null
          summary_message_count?: number
          summary_updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "conversations_cadence_enrollment_id_fkey"
            columns: ["cadence_enrollment_id"]
            isOneToOne: false
            referencedRelation: "cadence_enrollments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversations_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversations_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
        ]
      }
      email_send_log: {
        Row: {
          created_at: string
          error_message: string | null
          id: string
          message_id: string | null
          metadata: Json | null
          recipient_email: string
          status: string
          template_name: string
        }
        Insert: {
          created_at?: string
          error_message?: string | null
          id?: string
          message_id?: string | null
          metadata?: Json | null
          recipient_email: string
          status: string
          template_name: string
        }
        Update: {
          created_at?: string
          error_message?: string | null
          id?: string
          message_id?: string | null
          metadata?: Json | null
          recipient_email?: string
          status?: string
          template_name?: string
        }
        Relationships: []
      }
      email_send_state: {
        Row: {
          auth_email_ttl_minutes: number
          batch_size: number
          id: number
          retry_after_until: string | null
          send_delay_ms: number
          transactional_email_ttl_minutes: number
          updated_at: string
        }
        Insert: {
          auth_email_ttl_minutes?: number
          batch_size?: number
          id?: number
          retry_after_until?: string | null
          send_delay_ms?: number
          transactional_email_ttl_minutes?: number
          updated_at?: string
        }
        Update: {
          auth_email_ttl_minutes?: number
          batch_size?: number
          id?: number
          retry_after_until?: string | null
          send_delay_ms?: number
          transactional_email_ttl_minutes?: number
          updated_at?: string
        }
        Relationships: []
      }
      email_unsubscribe_tokens: {
        Row: {
          created_at: string
          email: string
          id: string
          token: string
          used_at: string | null
        }
        Insert: {
          created_at?: string
          email: string
          id?: string
          token: string
          used_at?: string | null
        }
        Update: {
          created_at?: string
          email?: string
          id?: string
          token?: string
          used_at?: string | null
        }
        Relationships: []
      }
      execution_logs: {
        Row: {
          action: string
          ai_context: Json | null
          channel: string
          company_id: string
          created_at: string
          enrollment_id: string
          id: string
          lead_id: string
          message_content: string
          step_id: string
        }
        Insert: {
          action?: string
          ai_context?: Json | null
          channel?: string
          company_id: string
          created_at?: string
          enrollment_id: string
          id?: string
          lead_id: string
          message_content?: string
          step_id: string
        }
        Update: {
          action?: string
          ai_context?: Json | null
          channel?: string
          company_id?: string
          created_at?: string
          enrollment_id?: string
          id?: string
          lead_id?: string
          message_content?: string
          step_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "execution_logs_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "execution_logs_enrollment_id_fkey"
            columns: ["enrollment_id"]
            isOneToOne: false
            referencedRelation: "cadence_enrollments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "execution_logs_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "execution_logs_step_id_fkey"
            columns: ["step_id"]
            isOneToOne: false
            referencedRelation: "cadence_steps"
            referencedColumns: ["id"]
          },
        ]
      }
      gmail_account: {
        Row: {
          created_at: string
          email: string
          id: string
          is_active: boolean
          last_history_id: string | null
          last_synced_at: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          email: string
          id?: string
          is_active?: boolean
          last_history_id?: string | null
          last_synced_at?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          email?: string
          id?: string
          is_active?: boolean
          last_history_id?: string | null
          last_synced_at?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      integrations: {
        Row: {
          api_domain: string | null
          api_token: string | null
          company_id: string
          config: Json
          created_at: string
          id: string
          last_synced_at: string | null
          provider: Database["public"]["Enums"]["integration_provider"]
          status: string
          updated_at: string
        }
        Insert: {
          api_domain?: string | null
          api_token?: string | null
          company_id: string
          config?: Json
          created_at?: string
          id?: string
          last_synced_at?: string | null
          provider?: Database["public"]["Enums"]["integration_provider"]
          status?: string
          updated_at?: string
        }
        Update: {
          api_domain?: string | null
          api_token?: string | null
          company_id?: string
          config?: Json
          created_at?: string
          id?: string
          last_synced_at?: string | null
          provider?: Database["public"]["Enums"]["integration_provider"]
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "integrations_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      intent_action_rules: {
        Row: {
          actions: Json
          auto_execute: boolean
          category: Database["public"]["Enums"]["intent_category"]
          company_id: string
          created_at: string
          enabled: boolean
          id: string
          priority: number
          requires_confidence_above: number
          sub_intent: string | null
          updated_at: string
        }
        Insert: {
          actions?: Json
          auto_execute?: boolean
          category: Database["public"]["Enums"]["intent_category"]
          company_id: string
          created_at?: string
          enabled?: boolean
          id?: string
          priority?: number
          requires_confidence_above?: number
          sub_intent?: string | null
          updated_at?: string
        }
        Update: {
          actions?: Json
          auto_execute?: boolean
          category?: Database["public"]["Enums"]["intent_category"]
          company_id?: string
          created_at?: string
          enabled?: boolean
          id?: string
          priority?: number
          requires_confidence_above?: number
          sub_intent?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "intent_action_rules_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      knowledge_chunks: {
        Row: {
          chunk: string
          company_id: string
          created_at: string
          embedding: string | null
          id: string
          knowledge_id: string | null
          metadata: Json
          token_count: number | null
        }
        Insert: {
          chunk: string
          company_id: string
          created_at?: string
          embedding?: string | null
          id?: string
          knowledge_id?: string | null
          metadata?: Json
          token_count?: number | null
        }
        Update: {
          chunk?: string
          company_id?: string
          created_at?: string
          embedding?: string | null
          id?: string
          knowledge_id?: string | null
          metadata?: Json
          token_count?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "knowledge_chunks_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "knowledge_chunks_knowledge_id_fkey"
            columns: ["knowledge_id"]
            isOneToOne: false
            referencedRelation: "company_knowledge"
            referencedColumns: ["id"]
          },
        ]
      }
      lead_action_queue: {
        Row: {
          action_type: Database["public"]["Enums"]["action_type"]
          attempts: number
          company_id: string
          conversation_id: string | null
          created_at: string
          error: string | null
          executed_at: string | null
          id: string
          intent_log_id: string | null
          lead_id: string
          params: Json
          result: Json | null
          scheduled_for: string
          status: Database["public"]["Enums"]["action_status"]
          triggered_by: string | null
          updated_at: string
        }
        Insert: {
          action_type: Database["public"]["Enums"]["action_type"]
          attempts?: number
          company_id: string
          conversation_id?: string | null
          created_at?: string
          error?: string | null
          executed_at?: string | null
          id?: string
          intent_log_id?: string | null
          lead_id: string
          params?: Json
          result?: Json | null
          scheduled_for?: string
          status?: Database["public"]["Enums"]["action_status"]
          triggered_by?: string | null
          updated_at?: string
        }
        Update: {
          action_type?: Database["public"]["Enums"]["action_type"]
          attempts?: number
          company_id?: string
          conversation_id?: string | null
          created_at?: string
          error?: string | null
          executed_at?: string | null
          id?: string
          intent_log_id?: string | null
          lead_id?: string
          params?: Json
          result?: Json | null
          scheduled_for?: string
          status?: Database["public"]["Enums"]["action_status"]
          triggered_by?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "lead_action_queue_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lead_action_queue_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lead_action_queue_intent_log_id_fkey"
            columns: ["intent_log_id"]
            isOneToOne: false
            referencedRelation: "lead_intents_log"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lead_action_queue_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
        ]
      }
      lead_activities: {
        Row: {
          company_id: string
          created_at: string
          description: string | null
          id: string
          lead_id: string
          metadata: Json | null
          type: Database["public"]["Enums"]["activity_type"]
        }
        Insert: {
          company_id: string
          created_at?: string
          description?: string | null
          id?: string
          lead_id: string
          metadata?: Json | null
          type: Database["public"]["Enums"]["activity_type"]
        }
        Update: {
          company_id?: string
          created_at?: string
          description?: string | null
          id?: string
          lead_id?: string
          metadata?: Json | null
          type?: Database["public"]["Enums"]["activity_type"]
        }
        Relationships: [
          {
            foreignKeyName: "lead_activities_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lead_activities_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
        ]
      }
      lead_enrichment_jobs: {
        Row: {
          attempts: number
          company_id: string
          created_at: string
          error: string | null
          id: string
          lead_id: string
          next_run_at: string
          status: string
          steps_done: Json
          updated_at: string
        }
        Insert: {
          attempts?: number
          company_id: string
          created_at?: string
          error?: string | null
          id?: string
          lead_id: string
          next_run_at?: string
          status?: string
          steps_done?: Json
          updated_at?: string
        }
        Update: {
          attempts?: number
          company_id?: string
          created_at?: string
          error?: string | null
          id?: string
          lead_id?: string
          next_run_at?: string
          status?: string
          steps_done?: Json
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "lead_enrichment_jobs_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lead_enrichment_jobs_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
        ]
      }
      lead_insights: {
        Row: {
          analyzed_at: string | null
          company_id: string
          created_at: string | null
          id: string
          insights: Json
          lead_id: string
          raw_summary: string | null
          website_url: string | null
        }
        Insert: {
          analyzed_at?: string | null
          company_id: string
          created_at?: string | null
          id?: string
          insights?: Json
          lead_id: string
          raw_summary?: string | null
          website_url?: string | null
        }
        Update: {
          analyzed_at?: string | null
          company_id?: string
          created_at?: string | null
          id?: string
          insights?: Json
          lead_id?: string
          raw_summary?: string | null
          website_url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "lead_insights_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lead_insights_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: true
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
        ]
      }
      lead_intents_log: {
        Row: {
          category: Database["public"]["Enums"]["intent_category"]
          company_id: string
          confidence: number
          conversation_id: string | null
          created_at: string
          entities: Json
          id: string
          latency_ms: number | null
          lead_id: string
          message_excerpt: string | null
          message_id: string | null
          model_used: string | null
          raw_response: Json | null
          sentiment: string | null
          sub_intent: string | null
        }
        Insert: {
          category: Database["public"]["Enums"]["intent_category"]
          company_id: string
          confidence?: number
          conversation_id?: string | null
          created_at?: string
          entities?: Json
          id?: string
          latency_ms?: number | null
          lead_id: string
          message_excerpt?: string | null
          message_id?: string | null
          model_used?: string | null
          raw_response?: Json | null
          sentiment?: string | null
          sub_intent?: string | null
        }
        Update: {
          category?: Database["public"]["Enums"]["intent_category"]
          company_id?: string
          confidence?: number
          conversation_id?: string | null
          created_at?: string
          entities?: Json
          id?: string
          latency_ms?: number | null
          lead_id?: string
          message_excerpt?: string | null
          message_id?: string | null
          model_used?: string | null
          raw_response?: Json | null
          sentiment?: string | null
          sub_intent?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "lead_intents_log_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lead_intents_log_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lead_intents_log_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lead_intents_log_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: false
            referencedRelation: "messages"
            referencedColumns: ["id"]
          },
        ]
      }
      lead_memory: {
        Row: {
          company_id: string
          created_at: string
          facts: Json
          id: string
          last_message_count: number
          lead_id: string
          summary: string | null
          updated_at: string
        }
        Insert: {
          company_id: string
          created_at?: string
          facts?: Json
          id?: string
          last_message_count?: number
          lead_id: string
          summary?: string | null
          updated_at?: string
        }
        Update: {
          company_id?: string
          created_at?: string
          facts?: Json
          id?: string
          last_message_count?: number
          lead_id?: string
          summary?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "lead_memory_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lead_memory_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: true
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
        ]
      }
      lead_social_profiles: {
        Row: {
          bio: string | null
          company_id: string
          created_at: string
          followers: number | null
          handle: string | null
          id: string
          lead_id: string
          network: string
          posts_summary: string | null
          raw: Json | null
          recent_posts: Json | null
          scraped_at: string
          updated_at: string
          url: string | null
        }
        Insert: {
          bio?: string | null
          company_id: string
          created_at?: string
          followers?: number | null
          handle?: string | null
          id?: string
          lead_id: string
          network: string
          posts_summary?: string | null
          raw?: Json | null
          recent_posts?: Json | null
          scraped_at?: string
          updated_at?: string
          url?: string | null
        }
        Update: {
          bio?: string | null
          company_id?: string
          created_at?: string
          followers?: number | null
          handle?: string | null
          id?: string
          lead_id?: string
          network?: string
          posts_summary?: string | null
          raw?: Json | null
          recent_posts?: Json | null
          scraped_at?: string
          updated_at?: string
          url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "lead_social_profiles_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lead_social_profiles_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
        ]
      }
      leads: {
        Row: {
          address: string | null
          call_requested_at: string | null
          company_id: string
          company_name: string | null
          created_at: string
          email: string | null
          enrichment_status: string | null
          enrichment_updated_at: string | null
          facebook_url: string | null
          handoff_at: string | null
          handoff_reason: string | null
          handoff_required: boolean
          id: string
          instagram_url: string | null
          last_synced_at: string | null
          linkedin_company_url: string | null
          linkedin_url: string | null
          name: string
          pending_email_slot_hold_id: string | null
          phone: string | null
          pipedrive_data: Json | null
          pipedrive_id: number | null
          pipeline_mode: string
          preferred_channel: string | null
          referral_context: string | null
          referral_followup_sent_at: string | null
          referral_permission_to_mention: boolean | null
          referral_role: string | null
          referral_source_lead_id: string | null
          referral_stage: string | null
          score: number | null
          source: string | null
          status: Database["public"]["Enums"]["lead_status"]
          title: string | null
          updated_at: string
          website: string | null
          whatsapp: string | null
          whatsapp_check_error: string | null
          whatsapp_checked_at: string | null
          whatsapp_source: string | null
          whatsapp_valid: boolean | null
        }
        Insert: {
          address?: string | null
          call_requested_at?: string | null
          company_id: string
          company_name?: string | null
          created_at?: string
          email?: string | null
          enrichment_status?: string | null
          enrichment_updated_at?: string | null
          facebook_url?: string | null
          handoff_at?: string | null
          handoff_reason?: string | null
          handoff_required?: boolean
          id?: string
          instagram_url?: string | null
          last_synced_at?: string | null
          linkedin_company_url?: string | null
          linkedin_url?: string | null
          name: string
          pending_email_slot_hold_id?: string | null
          phone?: string | null
          pipedrive_data?: Json | null
          pipedrive_id?: number | null
          pipeline_mode?: string
          preferred_channel?: string | null
          referral_context?: string | null
          referral_followup_sent_at?: string | null
          referral_permission_to_mention?: boolean | null
          referral_role?: string | null
          referral_source_lead_id?: string | null
          referral_stage?: string | null
          score?: number | null
          source?: string | null
          status?: Database["public"]["Enums"]["lead_status"]
          title?: string | null
          updated_at?: string
          website?: string | null
          whatsapp?: string | null
          whatsapp_check_error?: string | null
          whatsapp_checked_at?: string | null
          whatsapp_source?: string | null
          whatsapp_valid?: boolean | null
        }
        Update: {
          address?: string | null
          call_requested_at?: string | null
          company_id?: string
          company_name?: string | null
          created_at?: string
          email?: string | null
          enrichment_status?: string | null
          enrichment_updated_at?: string | null
          facebook_url?: string | null
          handoff_at?: string | null
          handoff_reason?: string | null
          handoff_required?: boolean
          id?: string
          instagram_url?: string | null
          last_synced_at?: string | null
          linkedin_company_url?: string | null
          linkedin_url?: string | null
          name?: string
          pending_email_slot_hold_id?: string | null
          phone?: string | null
          pipedrive_data?: Json | null
          pipedrive_id?: number | null
          pipeline_mode?: string
          preferred_channel?: string | null
          referral_context?: string | null
          referral_followup_sent_at?: string | null
          referral_permission_to_mention?: boolean | null
          referral_role?: string | null
          referral_source_lead_id?: string | null
          referral_stage?: string | null
          score?: number | null
          source?: string | null
          status?: Database["public"]["Enums"]["lead_status"]
          title?: string | null
          updated_at?: string
          website?: string | null
          whatsapp?: string | null
          whatsapp_check_error?: string | null
          whatsapp_checked_at?: string | null
          whatsapp_source?: string | null
          whatsapp_valid?: boolean | null
        }
        Relationships: [
          {
            foreignKeyName: "leads_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "leads_referral_source_lead_id_fkey"
            columns: ["referral_source_lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
        ]
      }
      messages: {
        Row: {
          ai_suggested: boolean
          channel: string
          content: string
          conversation_id: string
          direction: string
          gmail_message_id: string | null
          gmail_thread_id: string | null
          id: string
          metadata: Json | null
          rfc_message_id: string | null
          sent_at: string
        }
        Insert: {
          ai_suggested?: boolean
          channel?: string
          content?: string
          conversation_id: string
          direction?: string
          gmail_message_id?: string | null
          gmail_thread_id?: string | null
          id?: string
          metadata?: Json | null
          rfc_message_id?: string | null
          sent_at?: string
        }
        Update: {
          ai_suggested?: boolean
          channel?: string
          content?: string
          conversation_id?: string
          direction?: string
          gmail_message_id?: string | null
          gmail_thread_id?: string | null
          id?: string
          metadata?: Json | null
          rfc_message_id?: string | null
          sent_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "messages_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
        ]
      }
      pending_inbound_runs: {
        Row: {
          attempts: number
          claimed_at: string | null
          company_id: string
          conversation_id: string | null
          created_at: string
          last_error: string | null
          last_inbound_at: string
          lead_id: string
          scheduled_at: string
          status: string
          updated_at: string
        }
        Insert: {
          attempts?: number
          claimed_at?: string | null
          company_id: string
          conversation_id?: string | null
          created_at?: string
          last_error?: string | null
          last_inbound_at?: string
          lead_id: string
          scheduled_at?: string
          status?: string
          updated_at?: string
        }
        Update: {
          attempts?: number
          claimed_at?: string | null
          company_id?: string
          conversation_id?: string | null
          created_at?: string
          last_error?: string | null
          last_inbound_at?: string
          lead_id?: string
          scheduled_at?: string
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string
          full_name: string | null
          id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          full_name?: string | null
          id?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          full_name?: string | null
          id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      script_templates: {
        Row: {
          base_script: string
          channel: Database["public"]["Enums"]["cadence_type"]
          company_id: string
          created_at: string
          created_by: string
          id: string
          is_ai_generated: boolean
          name: string
          segment: string
          tone: string
          updated_at: string
        }
        Insert: {
          base_script?: string
          channel?: Database["public"]["Enums"]["cadence_type"]
          company_id: string
          created_at?: string
          created_by: string
          id?: string
          is_ai_generated?: boolean
          name: string
          segment?: string
          tone?: string
          updated_at?: string
        }
        Update: {
          base_script?: string
          channel?: Database["public"]["Enums"]["cadence_type"]
          company_id?: string
          created_at?: string
          created_by?: string
          id?: string
          is_ai_generated?: boolean
          name?: string
          segment?: string
          tone?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "script_templates_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      script_variations: {
        Row: {
          created_at: string
          id: string
          template_id: string
          tone: string
          variation_text: string
        }
        Insert: {
          created_at?: string
          id?: string
          template_id: string
          tone?: string
          variation_text?: string
        }
        Update: {
          created_at?: string
          id?: string
          template_id?: string
          tone?: string
          variation_text?: string
        }
        Relationships: [
          {
            foreignKeyName: "script_variations_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "script_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      sdr_agent_runs: {
        Row: {
          company_id: string
          completion_tokens: number | null
          conversation_id: string | null
          created_at: string
          error: string | null
          final_output: Json | null
          id: string
          latency_ms: number | null
          lead_id: string | null
          mode: string
          model: string | null
          prompt_tokens: number | null
          status: string
          steps: Json
          total_tokens: number | null
          trigger: string
        }
        Insert: {
          company_id: string
          completion_tokens?: number | null
          conversation_id?: string | null
          created_at?: string
          error?: string | null
          final_output?: Json | null
          id?: string
          latency_ms?: number | null
          lead_id?: string | null
          mode?: string
          model?: string | null
          prompt_tokens?: number | null
          status?: string
          steps?: Json
          total_tokens?: number | null
          trigger: string
        }
        Update: {
          company_id?: string
          completion_tokens?: number | null
          conversation_id?: string | null
          created_at?: string
          error?: string | null
          final_output?: Json | null
          id?: string
          latency_ms?: number | null
          lead_id?: string | null
          mode?: string
          model?: string | null
          prompt_tokens?: number | null
          status?: string
          steps?: Json
          total_tokens?: number | null
          trigger?: string
        }
        Relationships: [
          {
            foreignKeyName: "sdr_agent_runs_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sdr_agent_runs_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sdr_agent_runs_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
        ]
      }
      slot_expiry_followups: {
        Row: {
          attempts: number
          company_id: string
          conversation_id: string | null
          created_at: string
          enrollment_id: string | null
          id: string
          last_action_at: string
          lead_id: string
          metadata: Json
          next_action_at: string | null
          stage: string
          updated_at: string
        }
        Insert: {
          attempts?: number
          company_id: string
          conversation_id?: string | null
          created_at?: string
          enrollment_id?: string | null
          id?: string
          last_action_at?: string
          lead_id: string
          metadata?: Json
          next_action_at?: string | null
          stage: string
          updated_at?: string
        }
        Update: {
          attempts?: number
          company_id?: string
          conversation_id?: string | null
          created_at?: string
          enrollment_id?: string | null
          id?: string
          last_action_at?: string
          lead_id?: string
          metadata?: Json
          next_action_at?: string | null
          stage?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "slot_expiry_followups_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "slot_expiry_followups_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "slot_expiry_followups_enrollment_id_fkey"
            columns: ["enrollment_id"]
            isOneToOne: false
            referencedRelation: "cadence_enrollments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "slot_expiry_followups_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: true
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
        ]
      }
      slot_holds: {
        Row: {
          cal_booking_uid: string | null
          company_id: string
          conversation_id: string | null
          created_at: string
          enrollment_id: string | null
          expires_at: string
          id: string
          lead_id: string
          metadata: Json
          preferred_channel: string | null
          slot_datetime: string
          status: string
        }
        Insert: {
          cal_booking_uid?: string | null
          company_id: string
          conversation_id?: string | null
          created_at?: string
          enrollment_id?: string | null
          expires_at: string
          id?: string
          lead_id: string
          metadata?: Json
          preferred_channel?: string | null
          slot_datetime: string
          status?: string
        }
        Update: {
          cal_booking_uid?: string | null
          company_id?: string
          conversation_id?: string | null
          created_at?: string
          enrollment_id?: string | null
          expires_at?: string
          id?: string
          lead_id?: string
          metadata?: Json
          preferred_channel?: string | null
          slot_datetime?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "slot_holds_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "slot_holds_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "slot_holds_enrollment_id_fkey"
            columns: ["enrollment_id"]
            isOneToOne: false
            referencedRelation: "cadence_enrollments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "slot_holds_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
        ]
      }
      suppressed_emails: {
        Row: {
          created_at: string
          email: string
          id: string
          metadata: Json | null
          reason: string
        }
        Insert: {
          created_at?: string
          email: string
          id?: string
          metadata?: Json | null
          reason: string
        }
        Update: {
          created_at?: string
          email?: string
          id?: string
          metadata?: Json | null
          reason?: string
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      delete_email: {
        Args: { message_id: number; queue_name: string }
        Returns: boolean
      }
      delete_lead_cascade: { Args: { p_lead_id: string }; Returns: undefined }
      enqueue_email: {
        Args: { payload: Json; queue_name: string }
        Returns: number
      }
      get_user_company_id: { Args: { _user_id: string }; Returns: string }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      match_knowledge_chunks: {
        Args: {
          p_company_id: string
          p_match_count?: number
          p_query_embedding: string
        }
        Returns: {
          chunk: string
          id: string
          knowledge_id: string
          metadata: Json
          similarity: number
        }[]
      }
      move_to_dlq: {
        Args: {
          dlq_name: string
          message_id: number
          payload: Json
          source_queue: string
        }
        Returns: number
      }
      read_email_batch: {
        Args: { batch_size: number; queue_name: string; vt: number }
        Returns: {
          message: Json
          msg_id: number
          read_ct: number
        }[]
      }
    }
    Enums: {
      action_status: "pending" | "done" | "failed" | "cancelled" | "skipped"
      action_type:
        | "send_reply"
        | "ask_clarifying_question"
        | "suggest_meeting_times"
        | "create_cal_booking"
        | "send_calendar_link"
        | "send_email"
        | "create_new_contact"
        | "mark_current_contact_as_referrer"
        | "schedule_followup"
        | "stop_sequence"
        | "mark_opt_out"
        | "handoff_to_human"
        | "create_call_task"
        | "send_material"
        | "update_lead_score"
        | "disqualify_lead"
        | "recover_no_show"
        | "request_info_from_lead"
        | "fetch_existing_booking"
        | "reschedule_booking"
        | "cancel_booking"
        | "ask_cancel_reason"
        | "offer_reschedule_instead"
        | "send_booking_confirmation"
        | "offer_event_types"
        | "collect_booking_info"
        | "detect_timezone"
        | "send_meeting_recap"
        | "request_feedback"
        | "mark_meeting_attended"
        | "acknowledge_cancellation"
      activity_type:
        | "email"
        | "call"
        | "whatsapp"
        | "linkedin"
        | "note"
        | "meeting"
        | "referral"
      app_role: "master_admin" | "company_admin" | "user"
      booking_status:
        | "pending"
        | "confirmed"
        | "rescheduled"
        | "cancelled"
        | "no_show"
        | "completed"
      cadence_status: "draft" | "active" | "paused" | "archived"
      cadence_type: "email" | "whatsapp" | "linkedin" | "multi_channel"
      company_status: "active" | "inactive" | "trial"
      enrollment_status:
        | "active"
        | "completed"
        | "replied"
        | "bounced"
        | "paused"
      integration_provider:
        | "pipedrive"
        | "gmail"
        | "twilio_whatsapp"
        | "apify"
        | "zapi_whatsapp"
      intent_category:
        | "interest"
        | "info_request"
        | "pricing"
        | "scheduling"
        | "rejection"
        | "routing"
        | "channel_switch"
        | "compliance"
        | "escalation"
        | "silence"
      lead_status:
        | "new"
        | "contacted"
        | "qualified"
        | "unqualified"
        | "converted"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      action_status: ["pending", "done", "failed", "cancelled", "skipped"],
      action_type: [
        "send_reply",
        "ask_clarifying_question",
        "suggest_meeting_times",
        "create_cal_booking",
        "send_calendar_link",
        "send_email",
        "create_new_contact",
        "mark_current_contact_as_referrer",
        "schedule_followup",
        "stop_sequence",
        "mark_opt_out",
        "handoff_to_human",
        "create_call_task",
        "send_material",
        "update_lead_score",
        "disqualify_lead",
        "recover_no_show",
        "request_info_from_lead",
        "fetch_existing_booking",
        "reschedule_booking",
        "cancel_booking",
        "ask_cancel_reason",
        "offer_reschedule_instead",
        "send_booking_confirmation",
        "offer_event_types",
        "collect_booking_info",
        "detect_timezone",
        "send_meeting_recap",
        "request_feedback",
        "mark_meeting_attended",
        "acknowledge_cancellation",
      ],
      activity_type: [
        "email",
        "call",
        "whatsapp",
        "linkedin",
        "note",
        "meeting",
        "referral",
      ],
      app_role: ["master_admin", "company_admin", "user"],
      booking_status: [
        "pending",
        "confirmed",
        "rescheduled",
        "cancelled",
        "no_show",
        "completed",
      ],
      cadence_status: ["draft", "active", "paused", "archived"],
      cadence_type: ["email", "whatsapp", "linkedin", "multi_channel"],
      company_status: ["active", "inactive", "trial"],
      enrollment_status: [
        "active",
        "completed",
        "replied",
        "bounced",
        "paused",
      ],
      integration_provider: [
        "pipedrive",
        "gmail",
        "twilio_whatsapp",
        "apify",
        "zapi_whatsapp",
      ],
      intent_category: [
        "interest",
        "info_request",
        "pricing",
        "scheduling",
        "rejection",
        "routing",
        "channel_switch",
        "compliance",
        "escalation",
        "silence",
      ],
      lead_status: [
        "new",
        "contacted",
        "qualified",
        "unqualified",
        "converted",
      ],
    },
  },
} as const
