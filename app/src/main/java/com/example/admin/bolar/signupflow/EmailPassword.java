package com.example.admin.bolar.signupflow;

import android.content.Intent;
import android.os.Bundle;
import androidx.annotation.NonNull;
import androidx.appcompat.app.AppCompatActivity;
import android.view.View;
import android.widget.Button;
import android.widget.EditText;

import com.example.admin.bolar.R;
import com.google.android.gms.tasks.OnCompleteListener;
import com.google.android.gms.tasks.Task;
import com.google.firebase.auth.AuthCredential;
import com.google.firebase.auth.AuthResult;
import com.google.firebase.auth.EmailAuthProvider;
import com.google.firebase.auth.FirebaseAuth;
import com.google.firebase.auth.FirebaseUser;

public class EmailPassword extends AppCompatActivity {

    private FirebaseAuth auth = FirebaseAuth.getInstance();
    private String type;
    private Button next;
    private EditText emailBox;
    private EditText passwordBox;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_email_password);
        Intent i = getIntent();
        type = i.getStringExtra("type");

        next = findViewById(R.id.next);
        emailBox = findViewById(R.id.email);
        passwordBox = findViewById(R.id.password);

        nextOnClick();
    }

    //When they click next
    public void nextOnClick(){
        next.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                String email = emailBox.getText().toString();
                String password = passwordBox.getText().toString();
                AuthCredential credential = EmailAuthProvider.getCredential(email,password);
                auth.getCurrentUser().linkWithCredential(credential).addOnCompleteListener(EmailPassword.this, new OnCompleteListener<AuthResult>() {
                            @Override
                            public void onComplete(@NonNull Task<AuthResult> task) {
                                if (task.isSuccessful()) {
                                    FirebaseUser user = task.getResult().getUser();
                                    Intent intent = new Intent(EmailPassword.this , Front_DL_Scan.class);
                                    intent.putExtra("type", type);
                                    EmailPassword.this.startActivity(intent);
                                    finish();
                                } else {
                                    //TODO: means there's already an email with that phone number or email given is invalid
                                }
                            }
                        });
            }
        });
    }
}
