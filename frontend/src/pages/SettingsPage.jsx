import { useState, useEffect } from "react";
import axios from "axios";
import { API, useAuth } from "@/App";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { toast } from "sonner";
import { 
  User, 
  Bell, 
  Shield, 
  Palette, 
  Mail,
  Building,
  Save,
  Loader2
} from "lucide-react";

export default function SettingsPage() {
  const { user, token } = useAuth();
  const [loading, setLoading] = useState(false);
  const [users, setUsers] = useState([]);
  const [profileData, setProfileData] = useState({
    name: user?.name || "",
    email: user?.email || ""
  });
  const [notifications, setNotifications] = useState({
    email_alerts: true,
    ticket_updates: true,
    device_offline: true,
    sla_warnings: true
  });

  const headers = { Authorization: `Bearer ${token}` };

  useEffect(() => {
    const fetchUsers = async () => {
      try {
        const response = await axios.get(`${API}/users`, { headers });
        setUsers(response.data);
      } catch (error) {
        console.error("Failed to fetch users");
      }
    };
    fetchUsers();
  }, []);

  const handleProfileSave = async () => {
    setLoading(true);
    // Simulate save - in real app would call API
    await new Promise(resolve => setTimeout(resolve, 500));
    toast.success("Profile updated successfully");
    setLoading(false);
  };

  return (
    <div className="space-y-8 max-w-4xl" data-testid="settings-page">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Settings</h1>
        <p className="text-muted-foreground">Manage your account and preferences</p>
      </div>

      {/* Profile Section */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <User className="w-5 h-5 text-primary" />
            <CardTitle>Profile</CardTitle>
          </div>
          <CardDescription>Update your personal information</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="flex items-center gap-6">
            <Avatar className="w-20 h-20">
              <AvatarImage src={user?.avatar} alt={user?.name} />
              <AvatarFallback className="text-xl bg-primary/20 text-primary">
                {user?.name?.split(' ').map(n => n[0]).join('')}
              </AvatarFallback>
            </Avatar>
            <div>
              <p className="font-semibold text-lg">{user?.name}</p>
              <Badge variant="outline" className="capitalize">{user?.role}</Badge>
            </div>
          </div>
          <Separator />
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="name">Full Name</Label>
              <Input
                id="name"
                value={profileData.name}
                onChange={(e) => setProfileData({ ...profileData, name: e.target.value })}
                data-testid="settings-name-input"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="email">Email Address</Label>
              <Input
                id="email"
                type="email"
                value={profileData.email}
                onChange={(e) => setProfileData({ ...profileData, email: e.target.value })}
                data-testid="settings-email-input"
              />
            </div>
          </div>
          <Button onClick={handleProfileSave} disabled={loading} data-testid="save-profile-button">
            {loading ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Save className="w-4 h-4 mr-2" />}
            Save Changes
          </Button>
        </CardContent>
      </Card>

      {/* Notifications */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Bell className="w-5 h-5 text-primary" />
            <CardTitle>Notifications</CardTitle>
          </div>
          <CardDescription>Configure how you receive alerts and updates</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label>Email Alerts</Label>
              <p className="text-sm text-muted-foreground">Receive critical alerts via email</p>
            </div>
            <Switch
              checked={notifications.email_alerts}
              onCheckedChange={(checked) => setNotifications({ ...notifications, email_alerts: checked })}
              data-testid="email-alerts-switch"
            />
          </div>
          <Separator />
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label>Ticket Updates</Label>
              <p className="text-sm text-muted-foreground">Get notified when tickets are updated</p>
            </div>
            <Switch
              checked={notifications.ticket_updates}
              onCheckedChange={(checked) => setNotifications({ ...notifications, ticket_updates: checked })}
              data-testid="ticket-updates-switch"
            />
          </div>
          <Separator />
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label>Device Offline Alerts</Label>
              <p className="text-sm text-muted-foreground">Alert when devices go offline</p>
            </div>
            <Switch
              checked={notifications.device_offline}
              onCheckedChange={(checked) => setNotifications({ ...notifications, device_offline: checked })}
              data-testid="device-offline-switch"
            />
          </div>
          <Separator />
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label>SLA Warnings</Label>
              <p className="text-sm text-muted-foreground">Notify before SLA deadlines</p>
            </div>
            <Switch
              checked={notifications.sla_warnings}
              onCheckedChange={(checked) => setNotifications({ ...notifications, sla_warnings: checked })}
              data-testid="sla-warnings-switch"
            />
          </div>
        </CardContent>
      </Card>

      {/* Team Members */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Shield className="w-5 h-5 text-primary" />
            <CardTitle>Team Members</CardTitle>
          </div>
          <CardDescription>View and manage team access</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {users.map(teamUser => (
              <div key={teamUser.id} className="flex items-center justify-between p-3 rounded-lg border border-border hover:bg-muted/50 transition-smooth">
                <div className="flex items-center gap-3">
                  <Avatar>
                    <AvatarImage src={teamUser.avatar} alt={teamUser.name} />
                    <AvatarFallback className="bg-primary/20 text-primary text-sm">
                      {teamUser.name?.split(' ').map(n => n[0]).join('')}
                    </AvatarFallback>
                  </Avatar>
                  <div>
                    <p className="font-medium">{teamUser.name}</p>
                    <p className="text-sm text-muted-foreground">{teamUser.email}</p>
                  </div>
                </div>
                <Badge variant="outline" className="capitalize">{teamUser.role}</Badge>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Company Info */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Building className="w-5 h-5 text-primary" />
            <CardTitle>Company Information</CardTitle>
          </div>
          <CardDescription>Your MSP business details</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Company Name</Label>
              <Input defaultValue="NexusOps MSP" data-testid="company-name-input" />
            </div>
            <div className="space-y-2">
              <Label>Support Email</Label>
              <Input defaultValue="support@nexusops.io" data-testid="support-email-input" />
            </div>
          </div>
          <div className="space-y-2">
            <Label>Business Address</Label>
            <Input defaultValue="123 Tech Lane, San Francisco, CA 94105" data-testid="business-address-input" />
          </div>
        </CardContent>
      </Card>

      {/* Appearance */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Palette className="w-5 h-5 text-primary" />
            <CardTitle>Appearance</CardTitle>
          </div>
          <CardDescription>Customize the look and feel</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-4">
            <div className="flex-1">
              <Label>Theme</Label>
              <p className="text-sm text-muted-foreground">Currently using dark theme for optimal visibility</p>
            </div>
            <Badge>Dark Mode</Badge>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
