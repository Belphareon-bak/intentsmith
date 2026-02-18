const plugin = require('tailwindcss/plugin');

module.exports = plugin(function ({ addUtilities, theme }) {
  const glassmorphismUtilities = {
    '.glass': {
      background: 'rgba(255, 255, 255, 0.05)',
      backdropFilter: 'blur(10px)',
      WebkitBackdropFilter: 'blur(10px)',
      border: '1px solid rgba(255, 255, 255, 0.1)',
    },
    '.glass-strong': {
      background: 'rgba(255, 255, 255, 0.1)',
      backdropFilter: 'blur(16px)',
      WebkitBackdropFilter: 'blur(16px)',
      border: '1px solid rgba(255, 255, 255, 0.15)',
    },
    '.glass-dark': {
      background: 'rgba(0, 0, 0, 0.3)',
      backdropFilter: 'blur(10px)',
      WebkitBackdropFilter: 'blur(10px)',
      border: '1px solid rgba(255, 255, 255, 0.08)',
    },
    '.glass-card': {
      background: 'rgba(255, 255, 255, 0.03)',
      backdropFilter: 'blur(12px)',
      WebkitBackdropFilter: 'blur(12px)',
      border: '1px solid rgba(255, 255, 255, 0.08)',
      boxShadow: '0 8px 32px 0 rgba(0, 0, 0, 0.37)',
      transition: 'all 0.3s ease',
      '&:hover': {
        background: 'rgba(255, 255, 255, 0.06)',
        border: '1px solid rgba(255, 255, 255, 0.12)',
        transform: 'translateY(-2px)',
        boxShadow: '0 12px 48px 0 rgba(0, 0, 0, 0.5)',
      },
    },
    '.gradient-border': {
      position: 'relative',
      '&::before': {
        content: '""',
        position: 'absolute',
        inset: 0,
        borderRadius: 'inherit',
        padding: '1px',
        background: 'linear-gradient(135deg, rgba(34,197,94,0.5), rgba(34,197,94,0.1))',
        WebkitMask: 'linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0)',
        WebkitMaskComposite: 'xor',
        maskComposite: 'exclude',
      },
    },
  };

  addUtilities(glassmorphismUtilities);
});
