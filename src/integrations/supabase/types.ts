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
      cadence_steps: {
        Row: {
          cadence_id: string
          channel: Database["public"]["Enums"]["cadence_type"]
          created_at: string
          delay_days: number
          id: string
          step_order: number
          subject: string | null
          template: string
          updated_at: string
        }
        Insert: {
          cadence_id: string
          channel?: Database["public"]["Enums"]["cadence_type"]
          created_at?: string
          delay_days?: number
          id?: string
          step_order?: number
          subject?: string | null
          template?: string
          updated_at?: string
        }
        Update: {
          cadence_id?: string
          channel?: Database["public"]["Enums"]["cadence_type"]
          created_at?: string
          delay_days?: number
          id?: string
          step_order?: number
          subject?: string | null
          template?: string
          updated_at?: string
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
          name: string
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
          name: string
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
          name?: string
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
      companies: {
        Row: {
          created_at: string
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
          created_at?: string
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
          created_at?: string
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
          file_path: string | null
          id: string
          source_url: string | null
          title: string
          type: string
          updated_at: string
        }
        Insert: {
          company_id: string
          content?: string
          created_at?: string
          file_path?: string | null
          id?: string
          source_url?: string | null
          title: string
          type?: string
          updated_at?: string
        }
        Update: {
          company_id?: string
          content?: string
          created_at?: string
          file_path?: string | null
          id?: string
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
        }
        Insert: {
          cadence_enrollment_id?: string | null
          channel?: Database["public"]["Enums"]["cadence_type"]
          company_id: string
          created_at?: string
          id?: string
          lead_id: string
        }
        Update: {
          cadence_enrollment_id?: string | null
          channel?: Database["public"]["Enums"]["cadence_type"]
          company_id?: string
          created_at?: string
          id?: string
          lead_id?: string
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
      integrations: {
        Row: {
          api_domain: string | null
          api_token: string
          company_id: string
          created_at: string
          id: string
          last_synced_at: string | null
          provider: Database["public"]["Enums"]["integration_provider"]
          status: string
          updated_at: string
        }
        Insert: {
          api_domain?: string | null
          api_token: string
          company_id: string
          created_at?: string
          id?: string
          last_synced_at?: string | null
          provider?: Database["public"]["Enums"]["integration_provider"]
          status?: string
          updated_at?: string
        }
        Update: {
          api_domain?: string | null
          api_token?: string
          company_id?: string
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
      leads: {
        Row: {
          company_id: string
          company_name: string | null
          created_at: string
          email: string | null
          id: string
          last_synced_at: string | null
          name: string
          phone: string | null
          pipedrive_data: Json | null
          pipedrive_id: number | null
          score: number | null
          source: string | null
          status: Database["public"]["Enums"]["lead_status"]
          title: string | null
          updated_at: string
        }
        Insert: {
          company_id: string
          company_name?: string | null
          created_at?: string
          email?: string | null
          id?: string
          last_synced_at?: string | null
          name: string
          phone?: string | null
          pipedrive_data?: Json | null
          pipedrive_id?: number | null
          score?: number | null
          source?: string | null
          status?: Database["public"]["Enums"]["lead_status"]
          title?: string | null
          updated_at?: string
        }
        Update: {
          company_id?: string
          company_name?: string | null
          created_at?: string
          email?: string | null
          id?: string
          last_synced_at?: string | null
          name?: string
          phone?: string | null
          pipedrive_data?: Json | null
          pipedrive_id?: number | null
          score?: number | null
          source?: string | null
          status?: Database["public"]["Enums"]["lead_status"]
          title?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "leads_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      messages: {
        Row: {
          ai_suggested: boolean
          content: string
          conversation_id: string
          direction: string
          id: string
          metadata: Json | null
          sent_at: string
        }
        Insert: {
          ai_suggested?: boolean
          content?: string
          conversation_id: string
          direction?: string
          id?: string
          metadata?: Json | null
          sent_at?: string
        }
        Update: {
          ai_suggested?: boolean
          content?: string
          conversation_id?: string
          direction?: string
          id?: string
          metadata?: Json | null
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
      activity_type:
        | "email"
        | "call"
        | "whatsapp"
        | "linkedin"
        | "note"
        | "meeting"
      app_role: "master_admin" | "company_admin" | "user"
      cadence_status: "draft" | "active" | "paused" | "archived"
      cadence_type: "email" | "whatsapp" | "linkedin" | "multi_channel"
      company_status: "active" | "inactive" | "trial"
      enrollment_status:
        | "active"
        | "completed"
        | "replied"
        | "bounced"
        | "paused"
      integration_provider: "pipedrive"
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
      activity_type: [
        "email",
        "call",
        "whatsapp",
        "linkedin",
        "note",
        "meeting",
      ],
      app_role: ["master_admin", "company_admin", "user"],
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
      integration_provider: ["pipedrive"],
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
