export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      audit_logs: {
        Row: {
          action: string
          actor_id: string | null
          created_at: string
          entity: string
          entity_id: string
          id: string
          new_value: Json | null
          old_value: Json | null
          org_id: string
          reason: string | null
        }
        Insert: {
          action: string
          actor_id?: string | null
          created_at?: string
          entity: string
          entity_id: string
          id?: string
          new_value?: Json | null
          old_value?: Json | null
          org_id: string
          reason?: string | null
        }
        Update: {
          action?: string
          actor_id?: string | null
          created_at?: string
          entity?: string
          entity_id?: string
          id?: string
          new_value?: Json | null
          old_value?: Json | null
          org_id?: string
          reason?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "audit_logs_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      invoices: {
        Row: {
          breakdown: Json
          created_at: string
          due_date: string
          electric_cents: number
          id: string
          issued_at: string | null
          lease_id: string
          org_id: string
          other_cents: number
          paid_cents: number
          period: string
          rent_cents: number
          service_cents: number
          status: Database["public"]["Enums"]["invoice_status"]
          total_cents: number
          updated_at: string
          water_cents: number
        }
        Insert: {
          breakdown?: Json
          created_at?: string
          due_date: string
          electric_cents?: number
          id?: string
          issued_at?: string | null
          lease_id: string
          org_id: string
          other_cents?: number
          paid_cents?: number
          period: string
          rent_cents?: number
          service_cents?: number
          status?: Database["public"]["Enums"]["invoice_status"]
          total_cents?: number
          updated_at?: string
          water_cents?: number
        }
        Update: {
          breakdown?: Json
          created_at?: string
          due_date?: string
          electric_cents?: number
          id?: string
          issued_at?: string | null
          lease_id?: string
          org_id?: string
          other_cents?: number
          paid_cents?: number
          period?: string
          rent_cents?: number
          service_cents?: number
          status?: Database["public"]["Enums"]["invoice_status"]
          total_cents?: number
          updated_at?: string
          water_cents?: number
        }
        Relationships: [
          {
            foreignKeyName: "invoices_lease_id_org_id_fkey"
            columns: ["lease_id", "org_id"]
            isOneToOne: false
            referencedRelation: "leases"
            referencedColumns: ["id", "org_id"]
          },
          {
            foreignKeyName: "invoices_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      leases: {
        Row: {
          billing_day: number
          created_at: string
          deposit_cents: number
          end_date: string | null
          id: string
          org_id: string
          rent_cents: number
          start_date: string
          status: Database["public"]["Enums"]["lease_status"]
          tenant_id: string
          unit_id: string
          updated_at: string
        }
        Insert: {
          billing_day?: number
          created_at?: string
          deposit_cents?: number
          end_date?: string | null
          id?: string
          org_id: string
          rent_cents: number
          start_date: string
          status?: Database["public"]["Enums"]["lease_status"]
          tenant_id: string
          unit_id: string
          updated_at?: string
        }
        Update: {
          billing_day?: number
          created_at?: string
          deposit_cents?: number
          end_date?: string | null
          id?: string
          org_id?: string
          rent_cents?: number
          start_date?: string
          status?: Database["public"]["Enums"]["lease_status"]
          tenant_id?: string
          unit_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "leases_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "leases_tenant_id_org_id_fkey"
            columns: ["tenant_id", "org_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id", "org_id"]
          },
          {
            foreignKeyName: "leases_unit_id_org_id_fkey"
            columns: ["unit_id", "org_id"]
            isOneToOne: false
            referencedRelation: "units"
            referencedColumns: ["id", "org_id"]
          },
        ]
      }
      maintenance_requests: {
        Row: {
          created_at: string
          description: string | null
          id: string
          org_id: string
          photos: string[]
          status: Database["public"]["Enums"]["maintenance_status"]
          tenant_id: string
          title: string
          unit_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          id?: string
          org_id: string
          photos?: string[]
          status?: Database["public"]["Enums"]["maintenance_status"]
          tenant_id: string
          title: string
          unit_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          description?: string | null
          id?: string
          org_id?: string
          photos?: string[]
          status?: Database["public"]["Enums"]["maintenance_status"]
          tenant_id?: string
          title?: string
          unit_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "maintenance_requests_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "maintenance_requests_tenant_id_org_id_fkey"
            columns: ["tenant_id", "org_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id", "org_id"]
          },
          {
            foreignKeyName: "maintenance_requests_unit_id_org_id_fkey"
            columns: ["unit_id", "org_id"]
            isOneToOne: false
            referencedRelation: "units"
            referencedColumns: ["id", "org_id"]
          },
        ]
      }
      meter_readings: {
        Row: {
          created_at: string
          electric_curr: number
          electric_prev: number
          flags: string[]
          id: string
          org_id: string
          override_reason: string | null
          period: string
          recorded_by: string | null
          unit_id: string
          updated_at: string
          water_curr: number
          water_prev: number
        }
        Insert: {
          created_at?: string
          electric_curr: number
          electric_prev?: number
          flags?: string[]
          id?: string
          org_id: string
          override_reason?: string | null
          period: string
          recorded_by?: string | null
          unit_id: string
          updated_at?: string
          water_curr: number
          water_prev?: number
        }
        Update: {
          created_at?: string
          electric_curr?: number
          electric_prev?: number
          flags?: string[]
          id?: string
          org_id?: string
          override_reason?: string | null
          period?: string
          recorded_by?: string | null
          unit_id?: string
          updated_at?: string
          water_curr?: number
          water_prev?: number
        }
        Relationships: [
          {
            foreignKeyName: "meter_readings_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "meter_readings_unit_id_org_id_fkey"
            columns: ["unit_id", "org_id"]
            isOneToOne: false
            referencedRelation: "units"
            referencedColumns: ["id", "org_id"]
          },
        ]
      }
      organizations: {
        Row: {
          created_at: string
          currency: string
          id: string
          name: string
          plan: Database["public"]["Enums"]["org_plan"]
          status: Database["public"]["Enums"]["org_status"]
          updated_at: string
        }
        Insert: {
          created_at?: string
          currency?: string
          id?: string
          name: string
          plan?: Database["public"]["Enums"]["org_plan"]
          status?: Database["public"]["Enums"]["org_status"]
          updated_at?: string
        }
        Update: {
          created_at?: string
          currency?: string
          id?: string
          name?: string
          plan?: Database["public"]["Enums"]["org_plan"]
          status?: Database["public"]["Enums"]["org_status"]
          updated_at?: string
        }
        Relationships: []
      }
      payments: {
        Row: {
          amount_cents: number
          created_at: string
          id: string
          invoice_id: string
          method: Database["public"]["Enums"]["payment_method"]
          note: string | null
          org_id: string
          paid_at: string
          recorded_by: string | null
        }
        Insert: {
          amount_cents: number
          created_at?: string
          id?: string
          invoice_id: string
          method: Database["public"]["Enums"]["payment_method"]
          note?: string | null
          org_id: string
          paid_at?: string
          recorded_by?: string | null
        }
        Update: {
          amount_cents?: number
          created_at?: string
          id?: string
          invoice_id?: string
          method?: Database["public"]["Enums"]["payment_method"]
          note?: string | null
          org_id?: string
          paid_at?: string
          recorded_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "payments_invoice_id_org_id_fkey"
            columns: ["invoice_id", "org_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id", "org_id"]
          },
          {
            foreignKeyName: "payments_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      properties: {
        Row: {
          address: string | null
          created_at: string
          id: string
          name: string
          org_id: string
          updated_at: string
        }
        Insert: {
          address?: string | null
          created_at?: string
          id?: string
          name: string
          org_id: string
          updated_at?: string
        }
        Update: {
          address?: string | null
          created_at?: string
          id?: string
          name?: string
          org_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "properties_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      reminder_logs: {
        Row: {
          channel: string
          id: string
          invoice_id: string
          kind: Database["public"]["Enums"]["reminder_kind"]
          org_id: string
          recipient: string | null
          sent_at: string
        }
        Insert: {
          channel?: string
          id?: string
          invoice_id: string
          kind: Database["public"]["Enums"]["reminder_kind"]
          org_id: string
          recipient?: string | null
          sent_at?: string
        }
        Update: {
          channel?: string
          id?: string
          invoice_id?: string
          kind?: Database["public"]["Enums"]["reminder_kind"]
          org_id?: string
          recipient?: string | null
          sent_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "reminder_logs_invoice_id_org_id_fkey"
            columns: ["invoice_id", "org_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id", "org_id"]
          },
          {
            foreignKeyName: "reminder_logs_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      subscriptions: {
        Row: {
          created_at: string
          org_id: string
          period_end: string | null
          plan: Database["public"]["Enums"]["org_plan"]
          status: string
          stripe_customer_id: string | null
          stripe_sub_id: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          org_id: string
          period_end?: string | null
          plan?: Database["public"]["Enums"]["org_plan"]
          status?: string
          stripe_customer_id?: string | null
          stripe_sub_id?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          org_id?: string
          period_end?: string | null
          plan?: Database["public"]["Enums"]["org_plan"]
          status?: string
          stripe_customer_id?: string | null
          stripe_sub_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "subscriptions_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: true
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      super_admins: {
        Row: {
          created_at: string
          note: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          note?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          note?: string | null
          user_id?: string
        }
        Relationships: []
      }
      tariffs: {
        Row: {
          created_at: string
          effective_from: string
          electric_rate_per_kwh: number
          id: string
          org_id: string
          service_fee_cents: number
          updated_at: string
          water_rate_per_unit: number
        }
        Insert: {
          created_at?: string
          effective_from: string
          electric_rate_per_kwh: number
          id?: string
          org_id: string
          service_fee_cents?: number
          updated_at?: string
          water_rate_per_unit: number
        }
        Update: {
          created_at?: string
          effective_from?: string
          electric_rate_per_kwh?: number
          id?: string
          org_id?: string
          service_fee_cents?: number
          updated_at?: string
          water_rate_per_unit?: number
        }
        Relationships: [
          {
            foreignKeyName: "tariffs_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      tenants: {
        Row: {
          created_at: string
          email: string | null
          full_name: string
          id: string
          org_id: string
          phone: string | null
          portal_user_id: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          email?: string | null
          full_name: string
          id?: string
          org_id: string
          phone?: string | null
          portal_user_id?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          email?: string | null
          full_name?: string
          id?: string
          org_id?: string
          phone?: string | null
          portal_user_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "tenants_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      units: {
        Row: {
          area: number | null
          base_rent_cents: number
          code: string
          created_at: string
          id: string
          org_id: string
          property_id: string
          status: Database["public"]["Enums"]["unit_status"]
          updated_at: string
        }
        Insert: {
          area?: number | null
          base_rent_cents?: number
          code: string
          created_at?: string
          id?: string
          org_id: string
          property_id: string
          status?: Database["public"]["Enums"]["unit_status"]
          updated_at?: string
        }
        Update: {
          area?: number | null
          base_rent_cents?: number
          code?: string
          created_at?: string
          id?: string
          org_id?: string
          property_id?: string
          status?: Database["public"]["Enums"]["unit_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "units_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "units_property_id_org_id_fkey"
            columns: ["property_id", "org_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id", "org_id"]
          },
        ]
      }
      users: {
        Row: {
          created_at: string
          email: string
          full_name: string | null
          id: string
          org_id: string
          role: Database["public"]["Enums"]["user_role"]
          updated_at: string
        }
        Insert: {
          created_at?: string
          email: string
          full_name?: string | null
          id: string
          org_id: string
          role?: Database["public"]["Enums"]["user_role"]
          updated_at?: string
        }
        Update: {
          created_at?: string
          email?: string
          full_name?: string | null
          id?: string
          org_id?: string
          role?: Database["public"]["Enums"]["user_role"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "users_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      compute_invoice_status: {
        Args: {
          p_as_of?: string
          p_due_date: string
          p_issued_at: string
          p_paid_cents: number
          p_total_cents: number
        }
        Returns: Database["public"]["Enums"]["invoice_status"]
      }
      create_organization_and_owner: {
        Args: { p_full_name?: string; p_org_name: string }
        Returns: string
      }
      current_org_id: { Args: never; Returns: string }
      current_tenant_id: { Args: never; Returns: string }
      current_tenant_invoice_ids: { Args: never; Returns: string[] }
      current_tenant_lease_ids: { Args: never; Returns: string[] }
      current_tenant_maintenance_ids: { Args: never; Returns: string[] }
      current_tenant_org_id: { Args: never; Returns: string }
      current_tenant_property_ids: { Args: never; Returns: string[] }
      current_tenant_unit_ids: { Args: never; Returns: string[] }
      current_user_role: {
        Args: never
        Returns: Database["public"]["Enums"]["user_role"]
      }
      is_super_admin: { Args: never; Returns: boolean }
      recalc_invoice_paid: {
        Args: { p_invoice_id: string }
        Returns: undefined
      }
      refresh_overdue_invoices: { Args: { p_as_of?: string }; Returns: number }
      sync_unit_status_for: { Args: { p_unit_id: string }; Returns: undefined }
    }
    Enums: {
      invoice_status: "draft" | "sent" | "partial" | "paid" | "overdue"
      lease_status: "active" | "ended"
      maintenance_status: "submitted" | "in_progress" | "done"
      org_plan: "mini" | "standard" | "pro"
      org_status: "trialing" | "active" | "past_due" | "canceled"
      payment_method: "cash" | "bank_transfer"
      reminder_kind: "before_due" | "overdue_1" | "overdue_7"
      unit_status: "vacant" | "occupied"
      user_role: "owner" | "manager"
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
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {
      invoice_status: ["draft", "sent", "partial", "paid", "overdue"],
      lease_status: ["active", "ended"],
      maintenance_status: ["submitted", "in_progress", "done"],
      org_plan: ["mini", "standard", "pro"],
      org_status: ["trialing", "active", "past_due", "canceled"],
      payment_method: ["cash", "bank_transfer"],
      reminder_kind: ["before_due", "overdue_1", "overdue_7"],
      unit_status: ["vacant", "occupied"],
      user_role: ["owner", "manager"],
    },
  },
} as const

