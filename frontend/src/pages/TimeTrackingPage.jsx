import { useState, useEffect } from "react";
import axios from "axios";
import { API, useAuth } from "@/App";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import { 
  Plus, 
  Clock,
  MoreVertical,
  Loader2,
  DollarSign,
  Timer,
  Play,
  Pause
} from "lucide-react";

export default function TimeTrackingPage() {
  const { token, user } = useAuth();
  const [timeEntries, setTimeEntries] = useState([]);
  const [tickets, setTickets] = useState([]);
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [isTimerRunning, setIsTimerRunning] = useState(false);
  const [timerStart, setTimerStart] = useState(null);
  const [timerTicket, setTimerTicket] = useState(null);
  const [elapsedTime, setElapsedTime] = useState(0);
  const [formData, setFormData] = useState({
    ticket_id: "",
    user_id: "",
    description: "",
    minutes: "",
    billable: true,
    date: new Date().toISOString().split('T')[0]
  });

  const headers = { Authorization: `Bearer ${token}` };

  const fetchData = async () => {
    setLoading(true);
    try {
      const [entriesRes, ticketsRes, usersRes] = await Promise.all([
        axios.get(`${API}/time-entries`, { headers }),
        axios.get(`${API}/tickets`, { headers }),
        axios.get(`${API}/users`, { headers })
      ]);
      setTimeEntries(entriesRes.data);
      setTickets(ticketsRes.data);
      setUsers(usersRes.data);
    } catch (error) {
      toast.error("Failed to fetch time entries");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
    if (user) {
      setFormData(prev => ({ ...prev, user_id: user.id }));
    }
  }, []);

  // Timer effect
  useEffect(() => {
    let interval;
    if (isTimerRunning && timerStart) {
      interval = setInterval(() => {
        setElapsedTime(Math.floor((Date.now() - timerStart) / 1000));
      }, 1000);
    }
    return () => clearInterval(interval);
  }, [isTimerRunning, timerStart]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      await axios.post(`${API}/time-entries`, {
        ...formData,
        minutes: parseInt(formData.minutes) || 0
      }, { headers });
      toast.success("Time entry added");
      setIsDialogOpen(false);
      resetForm();
      fetchData();
    } catch (error) {
      toast.error("Failed to add time entry");
    }
  };

  const handleDelete = async (id) => {
    if (!confirm("Delete this time entry?")) return;
    try {
      await axios.delete(`${API}/time-entries/${id}`, { headers });
      toast.success("Time entry deleted");
      fetchData();
    } catch (error) {
      toast.error("Failed to delete time entry");
    }
  };

  const startTimer = (ticketId) => {
    setTimerTicket(ticketId);
    setTimerStart(Date.now());
    setIsTimerRunning(true);
    setElapsedTime(0);
    toast.success("Timer started");
  };

  const stopTimer = async () => {
    if (!timerTicket || elapsedTime < 60) {
      toast.error("Timer must run for at least 1 minute");
      setIsTimerRunning(false);
      return;
    }

    const minutes = Math.round(elapsedTime / 60);
    try {
      await axios.post(`${API}/time-entries`, {
        ticket_id: timerTicket,
        user_id: user.id,
        description: "Time tracked via timer",
        minutes,
        billable: true,
        date: new Date().toISOString().split('T')[0]
      }, { headers });
      toast.success(`Logged ${minutes} minutes`);
      setIsTimerRunning(false);
      setTimerTicket(null);
      setTimerStart(null);
      setElapsedTime(0);
      fetchData();
    } catch (error) {
      toast.error("Failed to log time");
    }
  };

  const resetForm = () => {
    setFormData({
      ticket_id: "",
      user_id: user?.id || "",
      description: "",
      minutes: "",
      billable: true,
      date: new Date().toISOString().split('T')[0]
    });
  };

  const formatTime = (seconds) => {
    const hrs = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;
    return `${hrs.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  const totalMinutes = timeEntries.reduce((sum, e) => sum + (e.minutes || 0), 0);
  const totalBillable = timeEntries.filter(e => e.billable).reduce((sum, e) => sum + (e.total_amount || 0), 0);

  return (
    <div className="space-y-6" data-testid="time-tracking-page">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Time Tracking</h1>
          <p className="text-muted-foreground">Track billable hours on tickets</p>
        </div>
        <div className="flex gap-2">
          {isTimerRunning ? (
            <Button variant="destructive" onClick={stopTimer}>
              <Pause className="w-4 h-4 mr-2" />
              Stop ({formatTime(elapsedTime)})
            </Button>
          ) : null}
          <Dialog open={isDialogOpen} onOpenChange={(open) => { setIsDialogOpen(open); if (!open) resetForm(); }}>
            <DialogTrigger asChild>
              <Button data-testid="add-time-entry-button">
                <Plus className="w-4 h-4 mr-2" />
                Log Time
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Log Time Entry</DialogTitle>
              </DialogHeader>
              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="space-y-2">
                  <Label>Ticket</Label>
                  <Select
                    value={formData.ticket_id}
                    onValueChange={(value) => setFormData({ ...formData, ticket_id: value })}
                    required
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select ticket" />
                    </SelectTrigger>
                    <SelectContent>
                      {tickets.filter(t => t.status !== 'resolved').map(ticket => (
                        <SelectItem key={ticket.id} value={ticket.id}>
                          {ticket.title} ({ticket.client_name})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Minutes</Label>
                    <Input
                      type="number"
                      value={formData.minutes}
                      onChange={(e) => setFormData({ ...formData, minutes: e.target.value })}
                      placeholder="30"
                      required
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Date</Label>
                    <Input
                      type="date"
                      value={formData.date}
                      onChange={(e) => setFormData({ ...formData, date: e.target.value })}
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label>Description</Label>
                  <Textarea
                    value={formData.description}
                    onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                    placeholder="What did you work on?"
                    rows={2}
                    required
                  />
                </div>
                <div className="flex items-center justify-between">
                  <Label>Billable</Label>
                  <Switch
                    checked={formData.billable}
                    onCheckedChange={(checked) => setFormData({ ...formData, billable: checked })}
                  />
                </div>
                <DialogFooter>
                  <Button type="submit">Log Time</Button>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
              <Clock className="w-5 h-5 text-primary" />
            </div>
            <div>
              <p className="text-2xl font-bold">{Math.round(totalMinutes / 60)}h {totalMinutes % 60}m</p>
              <p className="text-xs text-muted-foreground">Total Time Logged</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-green-500/10 flex items-center justify-center">
              <DollarSign className="w-5 h-5 text-green-500" />
            </div>
            <div>
              <p className="text-2xl font-bold">${totalBillable.toLocaleString()}</p>
              <p className="text-xs text-muted-foreground">Billable Amount</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-blue-500/10 flex items-center justify-center">
              <Timer className="w-5 h-5 text-blue-500" />
            </div>
            <div>
              <p className="text-2xl font-bold">{timeEntries.length}</p>
              <p className="text-xs text-muted-foreground">Time Entries</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Quick Timer Section */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Quick Timer</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {tickets.filter(t => t.status !== 'resolved').slice(0, 6).map(ticket => (
              <div 
                key={ticket.id} 
                className="flex items-center justify-between p-3 border rounded-lg hover:bg-muted/50 transition-smooth"
              >
                <div className="flex-1 min-w-0 mr-3">
                  <p className="text-sm font-medium truncate">{ticket.title}</p>
                  <p className="text-xs text-muted-foreground">{ticket.client_name}</p>
                </div>
                <Button
                  size="sm"
                  variant={timerTicket === ticket.id && isTimerRunning ? "destructive" : "outline"}
                  onClick={() => {
                    if (timerTicket === ticket.id && isTimerRunning) {
                      stopTimer();
                    } else {
                      startTimer(ticket.id);
                    }
                  }}
                >
                  {timerTicket === ticket.id && isTimerRunning ? (
                    <Pause className="w-4 h-4" />
                  ) : (
                    <Play className="w-4 h-4" />
                  )}
                </Button>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Time Entries Table */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Recent Time Entries</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {loading ? (
            <div className="flex items-center justify-center h-64">
              <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <ScrollArea className="h-[400px]">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead>Ticket</TableHead>
                    <TableHead>User</TableHead>
                    <TableHead>Description</TableHead>
                    <TableHead>Duration</TableHead>
                    <TableHead>Amount</TableHead>
                    <TableHead>Date</TableHead>
                    <TableHead className="w-[50px]"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {timeEntries.length > 0 ? timeEntries.map(entry => (
                    <TableRow key={entry.id} className="table-row-hover">
                      <TableCell>
                        <div>
                          <p className="text-sm font-medium">{entry.ticket_title}</p>
                          <p className="text-xs text-muted-foreground">{entry.client_name}</p>
                        </div>
                      </TableCell>
                      <TableCell className="text-sm">{entry.user_name}</TableCell>
                      <TableCell className="text-sm max-w-[200px] truncate">{entry.description}</TableCell>
                      <TableCell>
                        <span className="font-mono text-sm">
                          {Math.floor(entry.minutes / 60)}h {entry.minutes % 60}m
                        </span>
                      </TableCell>
                      <TableCell>
                        {entry.billable ? (
                          <span className="font-semibold text-green-500">${entry.total_amount?.toFixed(2)}</span>
                        ) : (
                          <Badge variant="outline">Non-billable</Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-sm">{entry.date}</TableCell>
                      <TableCell>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" className="h-8 w-8">
                              <MoreVertical className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem 
                              className="text-destructive"
                              onClick={() => handleDelete(entry.id)}
                            >
                              Delete
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                    </TableRow>
                  )) : (
                    <TableRow>
                      <TableCell colSpan={7} className="text-center py-12">
                        <Clock className="w-12 h-12 mx-auto mb-4 text-muted-foreground opacity-50" />
                        <p className="text-muted-foreground">No time entries yet</p>
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </ScrollArea>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
