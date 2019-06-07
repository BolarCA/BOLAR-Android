package com.example.admin.bolar.signupflow;

import android.content.Intent;
import androidx.appcompat.app.AppCompatActivity;
import android.os.Bundle;
import android.view.View;
import android.widget.Button;
import com.example.admin.bolar.R;
import com.google.firebase.auth.FirebaseAuth;

public class InitialPrompt extends AppCompatActivity {

    private Button Tenant;
    private Button IndividualLandlord;
    private Button Company;
    private FirebaseAuth auth = FirebaseAuth.getInstance();

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        //checks if they are already signed in
        if (auth.getCurrentUser() != null) {
            //TODO: Send them to their home screen (dependent on which account they have)
        }

        setContentView(R.layout.activity_initial_prompt);

        Tenant = findViewById(R.id.tenantButton);
        IndividualLandlord = findViewById(R.id.IndividualLandlordButton);
        Company = findViewById(R.id.CompanyButton);

        onTenantClick();
        onILClick();
        onCClick();
    }

    public void onTenantClick(){
        Tenant.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                Intent i = new Intent(InitialPrompt.this, Phone.class);
                i.putExtra("type", "Tenant");
                InitialPrompt.this.startActivity(i);
            }
        });
    }
    public void onILClick(){
        IndividualLandlord.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                Intent i = new Intent(InitialPrompt.this, Phone.class);
                i.putExtra("type", "IndividualLandlord");
                InitialPrompt.this.startActivity(i);
            }
        });
    }
    public void onCClick(){
        Company.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                Intent i = new Intent(InitialPrompt.this, Phone.class);
                i.putExtra("type", "Company");
                InitialPrompt.this.startActivity(i);
            }
        });
    }

}
