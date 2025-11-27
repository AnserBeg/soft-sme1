import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useAuth } from '@/hooks/useAuth';
import { Loader2, Clock, Shield } from 'lucide-react';

export const LoginScreen: React.FC = () => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const { login, isLoading } = useAuth();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (email && password) {
      await login(email, password);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-background flex flex-col items-center justify-center p-4">
      {/* App Header */}
      <div className="text-center mb-8">
        <div className="flex items-center justify-center mb-4">
          <div className="bg-gradient-to-r from-gradient-primary-from to-gradient-primary-to p-4 rounded-2xl shadow-mobile">
            <Clock className="h-8 w-8 text-primary-foreground" />
          </div>
        </div>
        <h1 className="text-3xl font-bold text-foreground mb-2">ClockWise</h1>
        <p className="text-muted-foreground">Time Tracking Made Simple</p>
      </div>

      {/* Login Card */}
      <Card className="w-full max-w-sm shadow-card border-0">
        <CardHeader className="text-center pb-4">
          <CardTitle className="text-2xl font-semibold">Welcome Back</CardTitle>
          <CardDescription>Sign in to track your time</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-6">
            <div className="space-y-2">
              <Label htmlFor="email" className="text-sm font-medium">
                Email Address
              </Label>
              <Input
                id="email"
                type="email"
                placeholder="Enter your email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="h-12 text-base"
                required
                disabled={isLoading}
              />
            </div>
            
            <div className="space-y-2">
              <Label htmlFor="password" className="text-sm font-medium">
                Password
              </Label>
              <Input
                id="password"
                type="password"
                placeholder="Enter your password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="h-12 text-base"
                required
                disabled={isLoading}
              />
            </div>

            <Button 
              type="submit" 
              variant="mobile" 
              size="mobile"
              className="w-full"
              disabled={isLoading || !email || !password}
            >
              {isLoading ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Signing in...
                </>
              ) : (
                'Sign In'
              )}
            </Button>
          </form>
        </CardContent>
      </Card>

      {/* Security Badge */}
      <div className="flex items-center mt-8 text-muted-foreground">
        <Shield className="h-4 w-4 mr-2" />
        <p className="text-sm">Secure employee time tracking</p>
      </div>
    </div>
  );
};