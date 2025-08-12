import React, { useState } from 'react';
import { Button, ButtonProps } from '@mui/material';
import EmailIcon from '@mui/icons-material/Email';
import EmailModal from './EmailModal';

interface EmailButtonProps extends Omit<ButtonProps, 'onClick' | 'type'> {
  emailType?: 'custom' | 'sales-order' | 'purchase-order' | 'quote';
  recordId?: number;
  defaultTo?: string;
  defaultSubject?: string;
  defaultMessage?: string;
  variant?: 'text' | 'outlined' | 'contained';
  size?: 'small' | 'medium' | 'large';
  startIcon?: React.ReactNode;
  children?: React.ReactNode;
}

const EmailButton: React.FC<EmailButtonProps> = ({
  emailType = 'custom',
  recordId,
  defaultTo = '',
  defaultSubject = '',
  defaultMessage = '',
  variant = 'outlined',
  size = 'medium',
  startIcon,
  children,
  ...buttonProps
}) => {
  const [emailModalOpen, setEmailModalOpen] = useState(false);

  const handleClick = () => {
    setEmailModalOpen(true);
  };

  const getButtonText = () => {
    if (children) return children;
    
    switch (emailType) {
      case 'sales-order':
        return 'Email Customer';
      case 'purchase-order':
        return 'Email Vendor';
      case 'quote':
        return 'Email Quote';
      default:
        return 'Send Email';
    }
  };

  const getButtonIcon = () => {
    if (startIcon) return startIcon;
    return <EmailIcon />;
  };

  return (
    <>
      <Button
        variant={variant}
        size={size}
        startIcon={getButtonIcon()}
        onClick={handleClick}
        {...buttonProps}
      >
        {getButtonText()}
      </Button>

      <EmailModal
        open={emailModalOpen}
        onClose={() => setEmailModalOpen(false)}
        type={emailType}
        recordId={recordId}
        defaultTo={defaultTo}
        defaultSubject={defaultSubject}
        defaultMessage={defaultMessage}
      />
    </>
  );
};

export default EmailButton; 